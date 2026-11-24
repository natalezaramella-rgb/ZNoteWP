<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Email → nota. Il messaggio viene letto (IMAP o webhook), controllato
 * (destinatario, mittente ammesso, SPF/DKIM, limite orario), ridotto a
 * oggetto + corpo + allegati utili e subito sigillato con la chiave pubblica
 * dell'utente. Poi viene cancellato dalla casella.
 */
class ZNK_Mail
{
    const MAX_ATTACH = 5 * 1024 * 1024;
    const MAX_TOTAL = 10 * 1024 * 1024;

    public static function settings()
    {
        $c = get_option('znk_mail');
        $c = is_array($c) ? $c : [];
        return $c + ['mode' => 'off', 'address' => '', 'host' => '', 'port' => 993, 'secure' => 'ssl', 'user' => '', 'pass' => '', 'folder' => 'INBOX', 'webhook_secret' => ''];
    }

    public static function configured()
    {
        $c = self::settings();
        return $c['mode'] !== 'off' && $c['address'] !== '';
    }

    public static function address_for($u)
    {
        $c = self::settings();
        if (!$c['address'] || !$u || empty($u->inbox_token)) {
            return null;
        }
        list($local, $dom) = explode('@', $c['address'], 2);
        return $local . '+' . $u->inbox_token . '@' . $dom;
    }

    public static function example_address()
    {
        $c = self::settings();
        if (!$c['address']) {
            return 'note+k7qm2xpa9r@tuodominio.it';
        }
        list($local, $dom) = explode('@', $c['address'], 2);
        return $local . '+k7qm2xpa9r@' . $dom;
    }

    private static function log($line)
    {
        $l = get_option('znk_mail_log');
        $l = is_array($l) ? $l : [];
        array_unshift($l, gmdate('Y-m-d H:i') . ' UTC · ' . $line);
        update_option('znk_mail_log', array_slice($l, 0, 30), false);
    }

    public static function poll($manual = false)
    {
        $c = self::settings();
        if ($c['mode'] !== 'imap') {
            return 'La ricezione IMAP non è attiva.';
        }
        if (!$c['host'] || !$c['user'] || !$c['pass']) {
            return 'Configurazione IMAP incompleta.';
        }
        if (!$manual && get_transient('znk_mail_lock')) {
            return 'Controllo già in corso.';
        }
        set_transient('znk_mail_lock', 1, 120);
        $pass = ZNK_Secret::decrypt($c['pass'], ZNK_Secret::key_for('imap'));
        $im = new ZNK_Imap();
        $res = '';
        if ($im->connect($c['host'], $c['port'], $c['secure']) && $im->login($c['user'], (string) $pass) && $im->select($c['folder'])) {
            $uids = array_slice($im->uids(), 0, 50);
            $stats = ['ok' => 0, 'skip' => 0];
            foreach ($uids as $uid) {
                $raw = $im->fetch($uid);
                if ($raw !== null) {
                    $r = self::process_raw($raw);
                    $stats[$r === true ? 'ok' : 'skip']++;
                }
                $im->delete($uid);
            }
            if ($uids) {
                $im->expunge();
            }
            $res = sprintf('Casella letta: %d messaggi, %d importati, %d scartati.', count($uids), $stats['ok'], $stats['skip']);
        } else {
            $res = 'Errore: ' . $im->error;
            self::log($res);
        }
        $im->logout();
        delete_transient('znk_mail_lock');
        update_option('znk_mail_last_check', gmdate('c'), false);
        return $res;
    }

    public static function webhook($req)
    {
        $c = self::settings();
        $key = (string) $req->get_param('key');
        if ($c['mode'] !== 'webhook' || !$c['webhook_secret'] || !hash_equals($c['webhook_secret'], $key)) {
            return new WP_Error('znk_forbidden', 'Non autorizzato.', ['status' => 403]);
        }
        $raw = '';
        foreach (['raw', 'email', 'body-mime', 'mime'] as $f) {
            $v = $req->get_param($f);
            if (is_string($v) && $v !== '') {
                $raw = $v;
                break;
            }
        }
        if ($raw === '') {
            $raw = (string) $req->get_body();
        }
        if (strlen($raw) > 40 * 1024 * 1024) {
            return ['ok' => false, 'reason' => 'too_big'];
        }
        $extra = [];
        foreach (['to', 'recipient', 'rcpt'] as $f) {
            $v = $req->get_param($f);
            if (is_string($v) && $v !== '') {
                $extra[] = strtolower($v);
            }
        }
        update_option('znk_mail_last_check', gmdate('c'), false);
        $r = self::process_raw($raw, $extra);
        return ['ok' => $r === true, 'reason' => $r === true ? null : $r];
    }

    /** @return true|string */
    public static function process_raw($raw, $extra_rcpt = [])
    {
        global $wpdb;
        $msg = ZNK_Mime::parse($raw);
        $rcpts = array_merge($extra_rcpt, ZNK_Mime::recipients($msg['headers']));
        $user = null;
        foreach ($rcpts as $a) {
            if (preg_match('/[+\-]([a-z0-9]{8,20})@/', $a, $m)) {
                $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . ZNK_DB::t('users') . ' WHERE inbox_token = %s', $m[1]));
                if ($row) {
                    $user = $row;
                    break;
                }
            }
        }
        $who = ZNK_Users::mask_email($msg['from']);
        if (!$user || !(int) $user->enabled || empty($user->vault)) {
            self::log("scartata (destinatario sconosciuto) da $who");
            return 'unknown_recipient';
        }
        $senders = json_decode((string) $user->senders, true) ?: [];
        if (!isset($senders[ZNK_Users::sender_hash($user, $msg['from'])])) {
            self::log("scartata (mittente non ammesso) da $who");
            return 'sender_not_allowed';
        }
        if (get_option('znk_mail_auth_check', 1) && !ZNK_Mime::authenticated($msg['headers'], $msg['from'])) {
            self::log("scartata (SPF/DKIM non superati) da $who");
            return 'not_authenticated';
        }
        // Limite orario.
        $limit = (int) get_option('znk_mail_rate', 30);
        $start = $user->mail_hour_start ? strtotime($user->mail_hour_start . ' UTC') : 0;
        $count = (int) $user->mail_hour_count;
        if ($start < time() - HOUR_IN_SECONDS) {
            $start = time();
            $count = 0;
        }
        if ($count >= $limit) {
            self::log("scartata (limite orario) da $who");
            return 'rate_limited';
        }
        ZNK_Users::update($user->user_id, ['mail_hour_start' => gmdate('Y-m-d H:i:s', $start), 'mail_hour_count' => $count + 1]);

        $atts = [];
        $total = 0;
        foreach ($msg['attachments'] as $a) {
            $keep = (strpos($a['type'], 'image/') === 0 || $a['type'] === 'application/pdf') && $a['size'] <= self::MAX_ATTACH && $total + $a['size'] <= self::MAX_TOTAL;
            $atts[] = [
                'name' => mb_substr($a['name'], 0, 200),
                'type' => $a['type'],
                'size' => $a['size'],
                'cid' => $a['cid'],
                'data' => $keep ? base64_encode($a['data']) : null,
            ];
            if ($keep) {
                $total += $a['size'];
            }
        }
        $ok = self::deliver($user, [
            'subject' => mb_substr($msg['subject'] !== '' ? $msg['subject'] : '(senza oggetto)', 0, 500),
            'from' => $msg['from'],
            'from_name' => mb_substr($msg['from_name'], 0, 200),
            'date' => $msg['date'] ? gmdate('c', strtotime($msg['date']) ?: time()) : gmdate('c'),
            'text' => mb_substr(trim($msg['text']), 0, 300000),
            'html' => mb_substr($msg['html'], 0, 600000),
            'attachments' => $atts,
        ]);
        self::log($ok ? "importata da $who" : "errore di cifratura per $who");
        return $ok ? true : 'seal_failed';
    }

    public static function deliver($user, array $payload)
    {
        global $wpdb;
        $v = json_decode((string) $user->vault, true);
        if (empty($v['pub'])) {
            return false;
        }
        $sealed = ZNK_Secret::seal(wp_json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE), $v['pub']);
        if (!$sealed) {
            return false;
        }
        return (bool) $wpdb->insert(ZNK_DB::t('inbox'), [
            'user_id' => (int) $user->user_id,
            'received_at' => ZNK_DB::now(),
            'size' => strlen($sealed),
            'sealed' => $sealed,
        ]);
    }
}

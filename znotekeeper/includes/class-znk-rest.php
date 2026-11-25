<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * API REST dell'app (namespace znk/v1). Ogni query è filtrata per user_id
 * dell'utente collegato: nessun utente può leggere o modificare dati di altri.
 */
class ZNK_REST
{
    const NS = 'znk/v1';
    const KINDS = ['notebook', 'group', 'section', 'page', 'list', 'task', 'drawing', 'blob', 'settings', 'access', 'secret', 'vfolder'];
    const MAX_DATA = 16 * 1024 * 1024;

    public static function init()
    {
        add_action('rest_api_init', [__CLASS__, 'routes']);
        // Le risposte dell'API non devono mai finire in cache.
        add_filter('rest_post_dispatch', function ($res, $server, $req) {
            if (strpos($req->get_route(), '/' . self::NS) === 0 && $res instanceof WP_REST_Response) {
                $res->header('Cache-Control', 'no-store, private');
            }
            return $res;
        }, 10, 3);
    }

    private static function r($route, $methods, $cb, $perm = 'session', $args = [])
    {
        register_rest_route(self::NS, $route, [
            'methods' => $methods,
            'callback' => function ($req) use ($cb, $perm) {
                if ($perm === 'device' || $perm === 'session') {
                    $ctx = $perm === 'device' ? ZNK_Auth::device_from_request($req) : ZNK_Auth::session_from_request($req);
                    if (is_wp_error($ctx)) {
                        return $ctx;
                    }
                    return call_user_func($cb, $req, $ctx);
                }
                return call_user_func($cb, $req, null);
            },
            'permission_callback' => function ($req) use ($perm) {
                if ($perm === 'cookie') {
                    return is_user_logged_in();
                }
                return true; // il controllo vero è nel callback (token del dispositivo)
            },
            'args' => $args,
        ]);
    }

    public static function routes()
    {
        $c = __CLASS__;
        self::r('/pair', 'POST', [$c, 'pair'], 'cookie');
        self::r('/recover/email/confirm', 'POST', [$c, 'email_confirm'], 'cookie');
        self::r('/mail/inbound', 'POST', ['ZNK_Mail', 'webhook'], 'public');

        self::r('/me', 'GET', [$c, 'me'], 'device');
        self::r('/setup', 'POST', [$c, 'setup'], 'device');
        self::r('/unlock', 'POST', [$c, 'unlock'], 'device');
        self::r('/unlock/key', 'POST', [$c, 'unlock_key'], 'device');
        self::r('/pin/unlock', 'POST', [$c, 'pin_unlock'], 'device');
        self::r('/remember/unlock', 'POST', [$c, 'remember_unlock'], 'device');
        self::r('/remember', 'DELETE', [$c, 'remember_off'], 'device');
        self::r('/lock', 'POST', [$c, 'lock'], 'device');
        self::r('/device', 'DELETE', [$c, 'unpair'], 'device');
        self::r('/recover/params', 'GET', [$c, 'recover_params'], 'device');
        self::r('/recover/code', 'POST', [$c, 'recover_code'], 'device');
        self::r('/recover/email/request', 'POST', [$c, 'email_request'], 'device');
        self::r('/recover/email/cancel', 'POST', [$c, 'email_cancel'], 'device');
        self::r('/recover/email/complete', 'POST', [$c, 'email_complete'], 'device');
        self::r('/recover/reset', 'POST', [$c, 'recover_reset'], 'device');

        self::r('/reauth', 'POST', [$c, 'reauth']);
        self::r('/vault/password', 'POST', [$c, 'change_password']);
        self::r('/vault/recovery-code', 'POST', [$c, 'new_recovery_code']);
        self::r('/vault/email-recovery', 'POST', [$c, 'email_recovery_toggle']);
        self::r('/devices', 'GET', [$c, 'devices']);
        self::r('/devices/(?P<id>\d+)', 'DELETE', [$c, 'device_delete']);
        self::r('/pin', 'POST', [$c, 'pin_enable']);
        self::r('/remember', 'POST', [$c, 'remember_on']);
        self::r('/pin', 'DELETE', [$c, 'pin_disable'], 'device');

        self::r('/sync', 'GET', [$c, 'sync']);
        self::r('/items/batch', 'POST', [$c, 'batch']);
        self::r('/items/(?P<id>[A-Za-z0-9_-]{1,40})', 'GET', [$c, 'item_get']);
        self::r('/items/(?P<id>[A-Za-z0-9_-]{1,40})', 'PUT', [$c, 'item_put']);
        self::r('/items/(?P<id>[A-Za-z0-9_-]{1,40})', 'DELETE', [$c, 'item_purge']);
        self::r('/items/(?P<id>[A-Za-z0-9_-]{1,40})/versions', 'GET', [$c, 'versions']);
        self::r('/items/(?P<id>[A-Za-z0-9_-]{1,40})/versions/(?P<vid>\d{1,12})', 'GET', [$c, 'version_one']);

        self::r('/inbox', 'GET', [$c, 'inbox']);
        self::r('/inbox/(?P<id>\d+)', 'DELETE', [$c, 'inbox_delete']);
        self::r('/mail', 'GET', [$c, 'mail_info']);
        self::r('/mail/senders', 'POST', [$c, 'sender_add']);
        self::r('/mail/senders/(?P<hash>[a-f0-9]{64})', 'DELETE', [$c, 'sender_delete']);
        self::r('/mail/regenerate', 'POST', [$c, 'mail_regenerate']);
        self::r('/mail/test', 'POST', [$c, 'mail_test']);

        self::r('/push', 'POST', [$c, 'push_subscribe']);
        self::r('/push', 'DELETE', [$c, 'push_unsubscribe'], 'device');
    }

    private static function err($code, $msg, $status = 400)
    {
        return new WP_Error($code, $msg, ['status' => $status]);
    }

    private static function json($req)
    {
        $p = $req->get_json_params();
        return is_array($p) ? $p : [];
    }

    private static function str($p, $k, $max = 4096)
    {
        $v = isset($p[$k]) ? $p[$k] : '';
        if (!is_string($v) || strlen($v) > $max) {
            return '';
        }
        return $v;
    }

    // ===================== Collegamento e stato =====================

    public static function pair($req)
    {
        $uid = get_current_user_id();
        if (!ZNK_Users::is_enabled($uid)) {
            return self::err('znk_disabled', 'Il tuo utente non è abilitato a ZNoteKeeper. Chiedi all\'amministratore del sito.', 403);
        }
        $p = self::json($req);
        $name = self::str($p, 'name', 300) ?: 'Dispositivo';
        return ['token' => ZNK_Auth::create_device($uid, $name)];
    }

    public static function me($req, $ctx)
    {
        $u = $ctx['user'];
        $wp = get_userdata($u->user_id);
        $vault = $u->vault ? json_decode($u->vault, true) : null;
        $er = ZNK_Users::email_recovery_state($u);
        if ($er === 'broken') {
            ZNK_Users::disable_email_recovery($u->user_id);
            $er = 'off';
        }
        return [
            'user' => [
                'name' => $wp->display_name,
                'login' => $wp->user_login,
                'email' => ZNK_Users::mask_email($wp->user_email),
                'admin' => user_can($wp, 'manage_options'),
                'admin_url' => admin_url('users.php?page=znotekeeper'),
            ],
            'device' => ['id' => (int) $ctx['device']->id, 'name' => $ctx['device']->name, 'pin' => !empty($ctx['device']->pin_hash), 'remember' => !empty($ctx['device']->rem_hash)],
            'has_vault' => (bool) $vault,
            'kdf' => $vault ? $vault['kdf'] : null,
            'recovery' => [
                'email' => $er,
                'ready_at' => $u->er_ready_at ? $u->er_ready_at . 'Z' : null,
                'code_created' => $u->rc_created_at ? $u->rc_created_at . 'Z' : null,
            ],
            'wait' => ZNK_Auth::throttle($u) ? max(0, strtotime($u->next_try_at . ' UTC') - time()) : 0,
            'mail' => ZNK_Mail::address_for($u),
            'push_key' => ZNK_Push::public_key(),
            'time' => time(),
        ];
    }

    /** Il vault contiene solo chiavi chiuse nel browser; qui si controlla solo la forma. */
    private static function valid_vault($v)
    {
        if (!is_array($v) || empty($v['kdf']['salt']) || empty($v['kdf']['iter']) || empty($v['pw']['iv']) || empty($v['pw']['ct'])) {
            return false;
        }
        if (empty($v['rc']['salt']) || empty($v['rc']['iv']) || empty($v['rc']['ct']) || empty($v['pub']) || empty($v['priv']['ct'])) {
            return false;
        }
        if ((int) $v['kdf']['iter'] < 100000) {
            return false;
        }
        return strlen(wp_json_encode($v)) < 64 * 1024;
    }

    private static function valid_pub($pem)
    {
        return is_string($pem) && strpos($pem, '-----BEGIN PUBLIC KEY-----') === 0 && openssl_pkey_get_public($pem) !== false;
    }

    public static function setup($req, $ctx)
    {
        $u = $ctx['user'];
        if (!empty($u->vault)) {
            return self::err('znk_exists', 'Lo spazio è già stato creato.', 409);
        }
        $p = self::json($req);
        $vault = isset($p['vault']) ? $p['vault'] : null;
        $pw = self::str($p, 'pw_auth', 200);
        $rc = self::str($p, 'rc_auth', 200);
        $mk = self::str($p, 'mk_auth', 200);
        if (!self::valid_vault($vault) || !self::valid_pub($vault['pub']) || !$pw || !$rc || !$mk) {
            return self::err('znk_bad', 'Dati di configurazione non validi.');
        }
        ZNK_Users::update($u->user_id, [
            'vault' => wp_json_encode($vault),
            'pw_auth' => ZNK_Auth::hash_secret($pw),
            'rc_auth' => ZNK_Auth::hash_secret($rc),
            'mk_auth' => ZNK_Auth::hash_secret($mk),
            'rc_created_at' => ZNK_DB::now(),
            'fails' => 0,
        ]);
        return ['session' => ZNK_Auth::issue_session($ctx['device'])];
    }

    public static function unlock($req, $ctx)
    {
        $u = $ctx['user'];
        if (empty($u->vault)) {
            return self::err('znk_no_vault', 'Spazio non ancora creato.', 409);
        }
        $p = self::json($req);
        if ($e = ZNK_Auth::verify_user_secret($u, self::str($p, 'auth', 200), $u->pw_auth)) {
            return $e;
        }
        return ['vault' => json_decode($u->vault, true), 'session' => ZNK_Auth::issue_session($ctx['device'])];
    }

    /** Sblocco con la chiave dello spazio già aperta sul dispositivo (impronta / volto). */
    public static function unlock_key($req, $ctx)
    {
        $u = $ctx['user'];
        $p = self::json($req);
        if (empty($u->mk_auth) || !ZNK_Auth::check_secret(self::str($p, 'mk_auth', 200), $u->mk_auth)) {
            return self::err('znk_bad_secret', 'Sblocco biometrico non più valido: usa la password.', 403);
        }
        return ['vault' => json_decode($u->vault, true), 'session' => ZNK_Auth::issue_session($ctx['device'])];
    }

    public static function pin_unlock($req, $ctx)
    {
        global $wpdb;
        $dev = $ctx['device'];
        if (empty($dev->pin_hash)) {
            return self::err('znk_no_pin', 'PIN non attivo su questo dispositivo.', 409);
        }
        $p = self::json($req);
        // Prenotazione atomica del tentativo: richieste in parallelo non superano i 5 PIN.
        $dt = ZNK_DB::t('devices');
        $ok = $wpdb->query($wpdb->prepare("UPDATE $dt SET pin_fails = LAST_INSERT_ID(pin_fails + 1) WHERE id = %d AND pin_hash IS NOT NULL AND pin_fails < 5", $dev->id));
        if (!$ok) {
            $wpdb->update($dt, ['pin_hash' => null, 'pin_pepper' => null, 'pin_fails' => 0], ['id' => $dev->id]);
            return self::err('znk_pin_off', 'PIN errato 5 volte: è stato disattivato. Usa la password.', 403);
        }
        $f = (int) $wpdb->get_var('SELECT LAST_INSERT_ID()');
        if (!ZNK_Auth::check_secret(self::str($p, 'pin_auth', 200), $dev->pin_hash)) {
            if ($f >= 5) {
                $wpdb->update($dt, ['pin_hash' => null, 'pin_pepper' => null, 'pin_fails' => 0], ['id' => $dev->id]);
                return self::err('znk_pin_off', 'PIN errato 5 volte: è stato disattivato. Usa la password.', 403);
            }
            return self::err('znk_bad_secret', 'PIN non corretto. Tentativi rimasti: ' . (5 - $f) . '.', 403);
        }
        $wpdb->update(ZNK_DB::t('devices'), ['pin_fails' => 0], ['id' => $dev->id]);
        return [
            'pepper' => $dev->pin_pepper,
            'vault' => json_decode($ctx['user']->vault, true),
            'session' => ZNK_Auth::issue_session($dev),
        ];
    }

    /** «Ricordami su questo dispositivo»: il sito tiene metà della chiave locale e la consegna solo a questo dispositivo. */
    public static function remember_on($req, $ctx)
    {
        global $wpdb;
        $p = self::json($req);
        $ra = self::str($p, 'rem_auth', 200);
        if (strlen($ra) < 40) {
            return self::err('znk_bad', 'Dati non validi.');
        }
        $pepper = base64_encode(random_bytes(32));
        $wpdb->update(ZNK_DB::t('devices'), ['rem_hash' => ZNK_Auth::hash_secret($ra), 'rem_pepper' => $pepper], ['id' => $ctx['device']->id]);
        return ['pepper' => $pepper];
    }

    public static function remember_unlock($req, $ctx)
    {
        global $wpdb;
        $dev = $ctx['device'];
        if (empty($dev->rem_hash)) {
            return self::err('znk_no_remember', 'Questo dispositivo non è più ricordato: inserisci la password.', 409);
        }
        $p = self::json($req);
        if (!ZNK_Auth::check_secret(self::str($p, 'rem_auth', 200), $dev->rem_hash)) {
            // Il segreto è casuale (256 bit): un errore vuol dire dati alterati, quindi si spegne subito.
            $wpdb->update(ZNK_DB::t('devices'), ['rem_hash' => null, 'rem_pepper' => null], ['id' => $dev->id]);
            return self::err('znk_no_remember', 'Questo dispositivo non è più ricordato: inserisci la password.', 403);
        }
        return [
            'pepper' => $dev->rem_pepper,
            'vault' => json_decode($ctx['user']->vault, true),
            'session' => ZNK_Auth::issue_session($dev),
        ];
    }

    public static function remember_off($req, $ctx)
    {
        global $wpdb;
        $wpdb->update(ZNK_DB::t('devices'), ['rem_hash' => null, 'rem_pepper' => null], ['id' => $ctx['device']->id]);
        return ['ok' => true];
    }

    public static function lock($req, $ctx)
    {
        ZNK_Auth::end_session($ctx['device']);
        return ['ok' => true];
    }

    public static function unpair($req, $ctx)
    {
        global $wpdb;
        $wpdb->delete(ZNK_DB::t('devices'), ['id' => $ctx['device']->id]);
        return ['ok' => true];
    }

    // ===================== Recupero =====================

    public static function recover_params($req, $ctx)
    {
        $v = json_decode((string) $ctx['user']->vault, true);
        if (!$v) {
            return self::err('znk_no_vault', 'Spazio non ancora creato.', 409);
        }
        return ['salt' => $v['rc']['salt'], 'iter' => isset($v['rc']['iter']) ? $v['rc']['iter'] : 0];
    }

    private static function issue_ticket($u)
    {
        $t = ZNK_Secret::token(32);
        ZNK_Users::update($u->user_id, [
            'reset_ticket_hash' => ZNK_Secret::hash($t),
            'reset_ticket_exp' => gmdate('Y-m-d H:i:s', time() + 15 * MINUTE_IN_SECONDS),
        ]);
        return $t;
    }

    public static function recover_code($req, $ctx)
    {
        $u = $ctx['user'];
        if (empty($u->vault)) {
            return self::err('znk_no_vault', 'Spazio non ancora creato.', 409);
        }
        $p = self::json($req);
        if ($e = ZNK_Auth::verify_user_secret($u, self::str($p, 'rc_auth', 200), $u->rc_auth, 'Codice di recupero non corretto.')) {
            return $e;
        }
        $v = json_decode($u->vault, true);
        return ['wrapped' => $v['rc'], 'priv' => $v['priv'], 'ticket' => self::issue_ticket($u)];
    }

    public static function email_request($req, $ctx)
    {
        $u = $ctx['user'];
        $state = ZNK_Users::email_recovery_state($u);
        if ($state === 'pending' || $state === 'ready') {
            return ['state' => $state, 'ready_at' => $u->er_ready_at . 'Z'];
        }
        if ($state !== 'on') {
            if ($state === 'broken') {
                ZNK_Users::disable_email_recovery($u->user_id);
            }
            return self::err('znk_er_off', 'Il recupero via email non è attivo per il tuo utente. Usa il codice di recupero.', 409);
        }
        if (!empty($u->er_token_exp) && strtotime($u->er_token_exp . ' UTC') > time() + 25 * MINUTE_IN_SECONDS) {
            return self::err('znk_wait', 'Ti abbiamo appena scritto: controlla la posta (anche nello spam).', 429);
        }
        $t = ZNK_Secret::token(32);
        ZNK_Users::update($u->user_id, [
            'er_token_hash' => ZNK_Secret::hash($t),
            'er_token_exp' => gmdate('Y-m-d H:i:s', time() + 30 * MINUTE_IN_SECONDS),
        ]);
        $link = ZNK_App::url('recover/') . '?t=' . rawurlencode($t);
        ZNK_Users::notify(
            $u->user_id,
            'link per recuperare l\'accesso',
            "Hai chiesto di recuperare l'accesso al tuo spazio ZNoteKeeper.\n\n"
            . "Apri questo link entro 30 minuti, dopo aver effettuato l'accesso al sito con il tuo utente:\n$link\n\n"
            . "Dopo il clic partirà un'attesa di 24 ore: durante l'attesa puoi annullare dall'app. Se non sei stato tu, ignora questa email."
        );
        return ['state' => 'sent', 'email' => ZNK_Users::mask_email(get_userdata($u->user_id)->user_email)];
    }

    /** Clic sul link (richiede l'accesso a WordPress con lo stesso utente). */
    public static function email_confirm($req)
    {
        $uid = get_current_user_id();
        $u = ZNK_Users::get($uid);
        $p = self::json($req);
        $t = self::str($p, 't', 200);
        if (!$u || !$t || empty($u->er_token_hash) || !hash_equals($u->er_token_hash, ZNK_Secret::hash($t))) {
            return self::err('znk_bad_link', 'Link non valido o già usato. Il link vale solo per l\'utente con cui hai effettuato l\'accesso.', 403);
        }
        if (strtotime($u->er_token_exp . ' UTC') < time()) {
            return self::err('znk_bad_link', 'Il link è scaduto: chiedine uno nuovo dall\'app.', 403);
        }
        if (ZNK_Users::email_recovery_state($u) !== 'on') {
            return self::err('znk_er_off', 'Il recupero via email non è più attivo.', 409);
        }
        $ready = gmdate('Y-m-d H:i:s', time() + DAY_IN_SECONDS);
        ZNK_Users::update($uid, ['er_token_hash' => null, 'er_token_exp' => null, 'er_ready_at' => $ready]);
        ZNK_Users::notify(
            $uid,
            'recupero dell\'accesso avviato',
            "È stato avviato il recupero dell'accesso al tuo spazio ZNoteKeeper tramite email.\n"
            . "Potrai completarlo dopo il " . get_date_from_gmt($ready, 'd/m/Y \a\l\l\e H:i') . ".\n\n"
            . "Se NON sei stato tu, apri l'app su un tuo dispositivo e tocca «Annulla recupero», poi cambia la password del tuo utente WordPress."
        );
        return ['ready_at' => $ready . 'Z'];
    }

    public static function email_cancel($req, $ctx)
    {
        ZNK_Users::update($ctx['user']->user_id, ['er_ready_at' => null, 'er_token_hash' => null, 'er_token_exp' => null]);
        ZNK_Users::notify($ctx['user']->user_id, 'recupero annullato', 'Il recupero dell\'accesso via email è stato annullato da un tuo dispositivo.');
        return ['ok' => true];
    }

    public static function email_complete($req, $ctx)
    {
        $u = $ctx['user'];
        $state = ZNK_Users::email_recovery_state($u);
        if ($state !== 'ready') {
            return self::err('znk_not_ready', $state === 'pending' ? 'L\'attesa di 24 ore non è ancora finita.' : 'Nessun recupero via email in corso.', 409);
        }
        $er = ZNK_Secret::decrypt($u->er_sealed, ZNK_Users::er_key($u->user_id));
        $v = json_decode($u->vault, true);
        return [
            'er' => base64_encode($er),
            'wrapped' => json_decode($u->er_wrapped, true),
            'priv' => $v['priv'],
            'ticket' => self::issue_ticket($u),
        ];
    }

    /** Nuova password + nuovo codice dopo un recupero. Scollega gli altri dispositivi. */
    public static function recover_reset($req, $ctx)
    {
        global $wpdb;
        $u = $ctx['user'];
        $p = self::json($req);
        $t = self::str($p, 'ticket', 200);
        if (!$t || empty($u->reset_ticket_hash) || !hash_equals($u->reset_ticket_hash, ZNK_Secret::hash($t)) || strtotime($u->reset_ticket_exp . ' UTC') < time()) {
            return self::err('znk_bad_ticket', 'Procedura di recupero scaduta: ricomincia.', 403);
        }
        $old = json_decode($u->vault, true);
        $new = isset($p['vault']) ? $p['vault'] : null;
        if (is_array($new)) {
            $new['pub'] = $old['pub'];
            $new['priv'] = $old['priv'];
        }
        $pw = self::str($p, 'pw_auth', 200);
        $rc = self::str($p, 'rc_auth', 200);
        if (!self::valid_vault($new) || !$pw || !$rc) {
            return self::err('znk_bad', 'Dati non validi.');
        }
        ZNK_Users::update($u->user_id, [
            'vault' => wp_json_encode($new),
            'pw_auth' => ZNK_Auth::hash_secret($pw),
            'rc_auth' => ZNK_Auth::hash_secret($rc),
            'rc_created_at' => ZNK_DB::now(),
            'reset_ticket_hash' => null,
            'reset_ticket_exp' => null,
            'er_sealed' => null, 'er_wrapped' => null, 'er_email' => null, 'er_ready_at' => null,
            'er_token_hash' => null, 'er_token_exp' => null,
            'fails' => 0, 'next_try_at' => null,
        ]);
        $wpdb->query($wpdb->prepare('DELETE FROM ' . ZNK_DB::t('devices') . ' WHERE user_id = %d AND id <> %d', $u->user_id, $ctx['device']->id));
        $wpdb->update(ZNK_DB::t('devices'), ['pin_hash' => null, 'pin_pepper' => null, 'rem_hash' => null, 'rem_pepper' => null], ['id' => $ctx['device']->id]);
        ZNK_Users::notify($u->user_id, 'accesso recuperato', "La password delle note è stata reimpostata e gli altri dispositivi sono stati scollegati.\nSe non sei stato tu, contatta subito l'amministratore del sito.");
        return ['session' => ZNK_Auth::issue_session($ctx['device'])];
    }

    // ===================== Sicurezza (sessione + password) =====================

    private static function require_password($u, $p)
    {
        return ZNK_Auth::verify_user_secret($u, self::str($p, 'auth', 200), $u->pw_auth);
    }

    public static function reauth($req, $ctx)
    {
        if ($e = self::require_password($ctx['user'], self::json($req))) {
            return $e;
        }
        return ['ok' => true];
    }

    public static function change_password($req, $ctx)
    {
        $u = $ctx['user'];
        $p = self::json($req);
        if ($e = self::require_password($u, $p)) {
            return $e;
        }
        $v = json_decode($u->vault, true);
        $kdf = isset($p['kdf']) ? $p['kdf'] : null;
        $pw = isset($p['pw']) ? $p['pw'] : null;
        $na = self::str($p, 'new_auth', 200);
        if (!is_array($kdf) || empty($kdf['salt']) || (int) $kdf['iter'] < 100000 || !is_array($pw) || empty($pw['ct']) || !$na) {
            return self::err('znk_bad', 'Dati non validi.');
        }
        $v['kdf'] = $kdf;
        $v['pw'] = $pw;
        ZNK_Users::update($u->user_id, ['vault' => wp_json_encode($v), 'pw_auth' => ZNK_Auth::hash_secret($na)]);
        ZNK_Users::notify($u->user_id, 'password delle note cambiata', 'La password delle note è stata cambiata. Se non sei stato tu, usa il codice di recupero e scollega i dispositivi.');
        return ['ok' => true];
    }

    public static function new_recovery_code($req, $ctx)
    {
        $u = $ctx['user'];
        $p = self::json($req);
        if ($e = self::require_password($u, $p)) {
            return $e;
        }
        $rc = isset($p['rc']) ? $p['rc'] : null;
        $ra = self::str($p, 'rc_auth', 200);
        if (!is_array($rc) || empty($rc['salt']) || empty($rc['ct']) || !$ra) {
            return self::err('znk_bad', 'Dati non validi.');
        }
        $v = json_decode($u->vault, true);
        $v['rc'] = $rc;
        ZNK_Users::update($u->user_id, ['vault' => wp_json_encode($v), 'rc_auth' => ZNK_Auth::hash_secret($ra), 'rc_created_at' => ZNK_DB::now()]);
        return ['ok' => true];
    }

    public static function email_recovery_toggle($req, $ctx)
    {
        $u = $ctx['user'];
        $p = self::json($req);
        if ($e = self::require_password($u, $p)) {
            return $e;
        }
        if (empty($p['enable'])) {
            ZNK_Users::disable_email_recovery($u->user_id);
            return ['state' => 'off'];
        }
        $er = base64_decode(self::str($p, 'er', 200), true);
        $w = isset($p['wrapped']) ? $p['wrapped'] : null;
        if (!$er || strlen($er) !== 32 || !is_array($w) || empty($w['iv']) || empty($w['ct'])) {
            return self::err('znk_bad', 'Dati non validi.');
        }
        $wp = get_userdata($u->user_id);
        ZNK_Users::update($u->user_id, [
            'er_sealed' => ZNK_Secret::encrypt($er, ZNK_Users::er_key($u->user_id)),
            'er_wrapped' => wp_json_encode($w),
            'er_email' => $wp->user_email,
            'er_ready_at' => null,
        ]);
        ZNK_Users::notify($u->user_id, 'recupero via email attivato', "Hai attivato il recupero via email. È legato a questo indirizzo e alla password attuale del tuo utente WordPress: se cambiano, si spegne da solo.");
        return ['state' => 'on'];
    }

    public static function devices($req, $ctx)
    {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare('SELECT id, name, created_at, last_seen, pin_hash, rem_hash, push_endpoint FROM ' . ZNK_DB::t('devices') . ' WHERE user_id = %d ORDER BY last_seen DESC', $ctx['user']->user_id));
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'id' => (int) $r->id,
                'name' => $r->name,
                'created' => $r->created_at . 'Z',
                'last_seen' => $r->last_seen . 'Z',
                'pin' => !empty($r->pin_hash),
                'remember' => !empty($r->rem_hash),
                'push' => !empty($r->push_endpoint),
                'current' => (int) $r->id === (int) $ctx['device']->id,
            ];
        }
        return $out;
    }

    public static function device_delete($req, $ctx)
    {
        global $wpdb;
        if ($e = self::require_password($ctx['user'], self::json($req))) {
            return $e;
        }
        $wpdb->delete(ZNK_DB::t('devices'), ['id' => (int) $req['id'], 'user_id' => (int) $ctx['user']->user_id]);
        return ['ok' => true];
    }

    public static function pin_enable($req, $ctx)
    {
        global $wpdb;
        $p = self::json($req);
        if ($e = self::require_password($ctx['user'], $p)) {
            return $e;
        }
        $pa = self::str($p, 'pin_auth', 200);
        if (!$pa) {
            return self::err('znk_bad', 'PIN non valido.');
        }
        $pepper = base64_encode(random_bytes(32));
        $wpdb->update(ZNK_DB::t('devices'), ['pin_hash' => ZNK_Auth::hash_secret($pa), 'pin_pepper' => $pepper, 'pin_fails' => 0], ['id' => $ctx['device']->id]);
        return ['pepper' => $pepper];
    }

    public static function pin_disable($req, $ctx)
    {
        global $wpdb;
        $wpdb->update(ZNK_DB::t('devices'), ['pin_hash' => null, 'pin_pepper' => null, 'pin_fails' => 0], ['id' => $ctx['device']->id]);
        return ['ok' => true];
    }

    // ===================== Dati =====================

    private static function out_item($r, $with_data = true)
    {
        $big = in_array($r->kind, ['blob', 'drawing'], true);
        return [
            'id' => $r->id,
            'kind' => $r->kind,
            'parent_id' => $r->parent_id,
            'sort' => (float) $r->sort,
            'due_at' => $r->due_at ? $r->due_at . 'Z' : null,
            'remind_at' => $r->remind_at ? $r->remind_at . 'Z' : null,
            'completed' => (int) $r->completed === 1,
            'deleted_at' => $r->deleted_at ? $r->deleted_at . 'Z' : null,
            'purged' => (int) $r->purged === 1,
            'rev' => (int) $r->rev,
            'seq' => (int) $r->seq,
            'size' => (int) $r->size,
            'updated_at' => $r->updated_at . 'Z',
            'created_at' => $r->created_at . 'Z',
            'data' => ($with_data && (!$big || $with_data === 'all')) ? $r->data : null,
            'lazy' => $big && $with_data !== 'all',
        ];
    }

    public static function sync($req, $ctx)
    {
        global $wpdb;
        $u = $ctx['user'];
        $since = max(0, (int) $req->get_param('since'));
        $full = $since === 0 || $since < (int) $u->purge_floor;
        $t = ZNK_DB::t('items');
        if ($full) {
            $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM $t WHERE user_id = %d AND purged = 0", $u->user_id));
        } else {
            $rows = $wpdb->get_results($wpdb->prepare("SELECT * FROM $t WHERE user_id = %d AND seq > %d", $u->user_id, $since));
        }
        $items = [];
        foreach ($rows as $r) {
            $items[] = self::out_item($r);
        }
        $inbox = (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM ' . ZNK_DB::t('inbox') . ' WHERE user_id = %d', $u->user_id));
        $er = ZNK_Users::email_recovery_state($u);
        return ['seq' => (int) $u->seq, 'full' => $full, 'items' => $items, 'inbox' => $inbox, 'recovery' => $er, 'ready_at' => $u->er_ready_at ? $u->er_ready_at . 'Z' : null];
    }

    public static function item_get($req, $ctx)
    {
        global $wpdb;
        $r = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . ZNK_DB::t('items') . ' WHERE user_id = %d AND id = %s', $ctx['user']->user_id, $req['id']));
        if (!$r) {
            return self::err('znk_404', 'Elemento non trovato.', 404);
        }
        return self::out_item($r, 'all');
    }

    private static function dt($v)
    {
        if (!is_string($v) || $v === '') {
            return null;
        }
        $ts = strtotime($v);
        return $ts ? gmdate('Y-m-d H:i:s', $ts) : null;
    }

    private static function next_seq($uid)
    {
        global $wpdb;
        $t = ZNK_DB::t('users');
        $wpdb->query($wpdb->prepare("UPDATE $t SET seq = LAST_INSERT_ID(seq + 1) WHERE user_id = %d", $uid));
        return (int) $wpdb->get_var('SELECT LAST_INSERT_ID()');
    }

    /** Applica una scrittura; restituisce l'elemento salvato o WP_Error (409 in caso di conflitto). */
    private static function write_item($uid, $id, $p)
    {
        global $wpdb;
        $t = ZNK_DB::t('items');
        if (!preg_match('/^[A-Za-z0-9_-]{1,40}$/', (string) $id)) {
            return self::err('znk_bad', 'Identificativo non valido.');
        }
        $cur = $wpdb->get_row($wpdb->prepare("SELECT * FROM $t WHERE user_id = %d AND id = %s", $uid, $id));
        if ($cur && isset($p['base_rev']) && (int) $p['base_rev'] !== (int) $cur->rev && empty($p['force'])) {
            return new WP_Error('znk_conflict', 'Modificato da un altro dispositivo.', ['status' => 409, 'current' => self::out_item($cur, 'all')]);
        }
        $kind = isset($p['kind']) ? (string) $p['kind'] : ($cur ? $cur->kind : '');
        if (!in_array($kind, self::KINDS, true)) {
            return self::err('znk_bad', 'Tipo non valido.');
        }
        $f = [];
        if (array_key_exists('data', $p)) {
            if (!is_string($p['data']) || strlen($p['data']) > self::MAX_DATA) {
                return self::err('znk_too_big', 'Elemento troppo grande.', 413);
            }
            $f['data'] = $p['data'];
            $f['size'] = strlen($p['data']);
        }
        if (array_key_exists('parent_id', $p)) {
            $f['parent_id'] = (is_string($p['parent_id']) && preg_match('/^[A-Za-z0-9_-]{1,40}$/', $p['parent_id'])) ? $p['parent_id'] : null;
        }
        if (array_key_exists('sort', $p)) {
            $f['sort'] = (float) $p['sort'];
        }
        if (array_key_exists('due_at', $p)) {
            $f['due_at'] = self::dt($p['due_at']);
        }
        if (array_key_exists('remind_at', $p)) {
            $f['remind_at'] = self::dt($p['remind_at']);
            if (!$cur || $cur->remind_at !== $f['remind_at']) {
                $f['reminded'] = 0;
            }
        }
        if (array_key_exists('completed', $p)) {
            $f['completed'] = $p['completed'] ? 1 : 0;
        }
        if (array_key_exists('deleted', $p)) {
            $f['deleted_at'] = $p['deleted'] ? ($cur && $cur->deleted_at ? $cur->deleted_at : ZNK_DB::now()) : null;
        }
        $now = ZNK_DB::now();
        $f['seq'] = self::next_seq($uid);
        $f['updated_at'] = $now;
        if ($cur) {
            if ((int) $cur->purged) {
                return self::err('znk_gone', 'Elemento eliminato definitivamente.', 410);
            }
            // Cronologia delle versioni delle pagine (punto 31): una copia ogni 10 minuti, ultime 50.
            // «I miei segreti»: ogni salvataggio (pulsante Salva) conserva la versione precedente, fino a 1000.
            if ($cur->kind === 'secret' && isset($f['data']) && $f['data'] !== $cur->data && $cur->data) {
                $vt = ZNK_DB::t('versions');
                $wpdb->insert($vt, ['user_id' => $uid, 'item_id' => $id, 'created_at' => $cur->updated_at, 'data' => $cur->data]);
                $ids = $wpdb->get_col($wpdb->prepare("SELECT id FROM $vt WHERE user_id = %d AND item_id = %s ORDER BY created_at DESC, id DESC LIMIT 1000, 1000", $uid, $id));
                if ($ids) {
                    $wpdb->query("DELETE FROM $vt WHERE id IN (" . implode(',', array_map('intval', $ids)) . ')');
                }
            }
            if ($cur->kind === 'page' && isset($f['data']) && $f['data'] !== $cur->data && $cur->data) {
                $vt = ZNK_DB::t('versions');
                $last = $wpdb->get_var($wpdb->prepare("SELECT MAX(created_at) FROM $vt WHERE user_id = %d AND item_id = %s", $uid, $id));
                if (!$last || strtotime($last . ' UTC') < time() - 600) {
                    $wpdb->insert($vt, ['user_id' => $uid, 'item_id' => $id, 'created_at' => $cur->updated_at, 'data' => $cur->data]);
                    $ids = $wpdb->get_col($wpdb->prepare("SELECT id FROM $vt WHERE user_id = %d AND item_id = %s ORDER BY created_at DESC LIMIT 50, 1000", $uid, $id));
                    if ($ids) {
                        $wpdb->query("DELETE FROM $vt WHERE id IN (" . implode(',', array_map('intval', $ids)) . ')');
                    }
                }
            }
            $f['rev'] = (int) $cur->rev + 1;
            $wpdb->update($t, $f, ['user_id' => $uid, 'id' => $id]);
        } else {
            $f += ['user_id' => $uid, 'id' => $id, 'kind' => $kind, 'created_at' => $now, 'rev' => 1];
            $f['kind'] = $kind;
            if (!isset($f['data'])) {
                $f['data'] = '';
            }
            if ($wpdb->insert($t, $f) === false) {
                return self::err('znk_db', 'Salvataggio non riuscito.', 500);
            }
        }
        $r = $wpdb->get_row($wpdb->prepare("SELECT * FROM $t WHERE user_id = %d AND id = %s", $uid, $id));
        $o = self::out_item($r, false);
        unset($o['data']);
        return $o;
    }

    public static function item_put($req, $ctx)
    {
        return self::write_item((int) $ctx['user']->user_id, $req['id'], self::json($req));
    }

    public static function batch($req, $ctx)
    {
        $p = self::json($req);
        $ops = isset($p['ops']) && is_array($p['ops']) ? array_slice($p['ops'], 0, 500) : [];
        $out = [];
        foreach ($ops as $op) {
            if (!is_array($op) || empty($op['id'])) {
                continue;
            }
            if (!empty($op['purge'])) {
                self::purge((int) $ctx['user']->user_id, (string) $op['id']);
                $out[] = ['id' => $op['id'], 'purged' => true];
                continue;
            }
            $r = self::write_item((int) $ctx['user']->user_id, (string) $op['id'], $op);
            if (is_wp_error($r)) {
                $d = $r->get_error_data();
                $out[] = ['id' => $op['id'], 'error' => $r->get_error_code(), 'message' => $r->get_error_message(), 'current' => isset($d['current']) ? $d['current'] : null];
            } else {
                $out[] = $r;
            }
        }
        return ['results' => $out];
    }

    public static function purge($uid, $id)
    {
        global $wpdb;
        $t = ZNK_DB::t('items');
        $wpdb->update($t, ['purged' => 1, 'data' => null, 'size' => 0, 'deleted_at' => ZNK_DB::now(), 'remind_at' => null, 'seq' => self::next_seq($uid), 'updated_at' => ZNK_DB::now()], ['user_id' => $uid, 'id' => $id]);
        $wpdb->delete(ZNK_DB::t('versions'), ['user_id' => $uid, 'item_id' => $id]);
    }

    public static function item_purge($req, $ctx)
    {
        self::purge((int) $ctx['user']->user_id, $req['id']);
        return ['ok' => true];
    }

    public static function versions($req, $ctx)
    {
        global $wpdb;
        if ($req->get_param('meta')) {
            // Solo l'elenco (data e dimensione): il contenuto si scarica una versione alla volta.
            $rows = $wpdb->get_results($wpdb->prepare('SELECT id, created_at, LENGTH(data) AS size FROM ' . ZNK_DB::t('versions') . ' WHERE user_id = %d AND item_id = %s ORDER BY created_at DESC, id DESC LIMIT 1000', $ctx['user']->user_id, $req['id']));
            $out = [];
            foreach ($rows as $r) {
                $out[] = ['id' => (int) $r->id, 'at' => $r->created_at . 'Z', 'size' => (int) $r->size];
            }
            return $out;
        }
        $rows = $wpdb->get_results($wpdb->prepare('SELECT id, created_at, data FROM ' . ZNK_DB::t('versions') . ' WHERE user_id = %d AND item_id = %s ORDER BY created_at DESC LIMIT 50', $ctx['user']->user_id, $req['id']));
        $out = [];
        foreach ($rows as $r) {
            $out[] = ['id' => (int) $r->id, 'at' => $r->created_at . 'Z', 'data' => $r->data];
        }
        return $out;
    }

    public static function version_one($req, $ctx)
    {
        global $wpdb;
        $r = $wpdb->get_row($wpdb->prepare('SELECT id, created_at, data FROM ' . ZNK_DB::t('versions') . ' WHERE user_id = %d AND item_id = %s AND id = %d', $ctx['user']->user_id, $req['id'], (int) $req['vid']));
        if (!$r) {
            return self::err('znk_not_found', 'Versione non trovata.', 404);
        }
        return ['id' => (int) $r->id, 'at' => $r->created_at . 'Z', 'data' => $r->data];
    }

    // ===================== Email → nota =====================

    public static function inbox($req, $ctx)
    {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare('SELECT id, received_at, sealed FROM ' . ZNK_DB::t('inbox') . ' WHERE user_id = %d ORDER BY id ASC LIMIT 20', $ctx['user']->user_id));
        $out = [];
        foreach ($rows as $r) {
            $out[] = ['id' => (int) $r->id, 'at' => $r->received_at . 'Z', 'sealed' => json_decode($r->sealed, true)];
        }
        return $out;
    }

    public static function inbox_delete($req, $ctx)
    {
        global $wpdb;
        $wpdb->delete(ZNK_DB::t('inbox'), ['id' => (int) $req['id'], 'user_id' => (int) $ctx['user']->user_id]);
        return ['ok' => true];
    }

    public static function mail_info($req, $ctx)
    {
        $u = $ctx['user'];
        $s = json_decode((string) $u->senders, true) ?: [];
        return [
            'address' => ZNK_Mail::address_for($u),
            'configured' => ZNK_Mail::configured(),
            'senders' => array_values($s),
            'auth_check' => (bool) get_option('znk_mail_auth_check', 1),
            'last_check' => get_option('znk_mail_last_check') ?: null,
            'interval' => 5,
        ];
    }

    public static function sender_add($req, $ctx)
    {
        $u = $ctx['user'];
        $p = self::json($req);
        $email = sanitize_email(self::str($p, 'email', 200));
        if (!$email || !is_email($email)) {
            return self::err('znk_bad', 'Indirizzo email non valido.');
        }
        $s = json_decode((string) $u->senders, true) ?: [];
        if (count($s) >= 30) {
            return self::err('znk_bad', 'Puoi autorizzare al massimo 30 mittenti.');
        }
        $h = ZNK_Users::sender_hash($u, $email);
        $s[$h] = ['hash' => $h, 'hint' => ZNK_Users::mask_email($email)];
        ZNK_Users::update($u->user_id, ['senders' => wp_json_encode($s)]);
        return array_values($s);
    }

    public static function sender_delete($req, $ctx)
    {
        $u = $ctx['user'];
        $s = json_decode((string) $u->senders, true) ?: [];
        unset($s[$req['hash']]);
        ZNK_Users::update($u->user_id, ['senders' => wp_json_encode($s)]);
        return array_values($s);
    }

    public static function mail_regenerate($req, $ctx)
    {
        $tok = ZNK_Users::new_inbox_token();
        ZNK_Users::update($ctx['user']->user_id, ['inbox_token' => $tok]);
        $ctx['user']->inbox_token = $tok;
        return ['address' => ZNK_Mail::address_for($ctx['user'])];
    }

    /** Crea una email di prova direttamente nella posta in arrivo cifrata. */
    public static function mail_test($req, $ctx)
    {
        $ok = ZNK_Mail::deliver($ctx['user'], [
            'subject' => 'Prova di ZNoteKeeper',
            'from' => 'ZNoteKeeper',
            'date' => gmdate('c'),
            'text' => "Questa è una nota di prova creata dal pulsante «Prova».\n\nLe email inoltrate al tuo indirizzo personale arriveranno così: oggetto come titolo, corpo come testo.",
            'html' => '',
            'attachments' => [],
        ]);
        return $ok ? ['ok' => true] : self::err('znk_seal', 'Impossibile cifrare la nota di prova.', 500);
    }

    // ===================== Promemoria =====================

    public static function push_subscribe($req, $ctx)
    {
        global $wpdb;
        $p = self::json($req);
        $ep = esc_url_raw(self::str($p, 'endpoint', 1000));
        if (!$ep || strpos($ep, 'https://') !== 0) {
            return self::err('znk_bad', 'Iscrizione non valida.');
        }
        $wpdb->update(ZNK_DB::t('devices'), ['push_endpoint' => $ep], ['id' => $ctx['device']->id]);
        return ['ok' => true];
    }

    public static function push_unsubscribe($req, $ctx)
    {
        global $wpdb;
        $wpdb->update(ZNK_DB::t('devices'), ['push_endpoint' => null], ['id' => $ctx['device']->id]);
        return ['ok' => true];
    }
}

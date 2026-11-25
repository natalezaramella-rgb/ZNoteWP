<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Verifica in due passaggi (facoltativa, la attiva il singolo utente).
 *
 * - Codice a 6 cifre da un'app di autenticazione (TOTP, RFC 6238: SHA-1, 30 secondi).
 * - Il sito consegna la cassaforte e apre una sessione solo dopo il codice, in
 *   aggiunta alla password delle note (o a PIN, impronta, «Ricordami»).
 * - Il segreto TOTP è cifrato con la chiave del sito; i codici di riserva sono
 *   conservati solo come impronte e valgono una volta.
 * - Ogni dispositivo può restare «fidato» per alcuni giorni dopo un codice
 *   corretto (0 = chiedi il codice a ogni sblocco).
 * - I tentativi sono contati in modo atomico, con attese crescenti.
 *
 * Limite da conoscere: protegge da chi conosce la password delle note ma non
 * ha il telefono. Non protegge da chi controlla il sito (amministratore) né
 * rende più forte la cifratura dei dati copiati dal database.
 */
class ZNK_Mfa
{
    const DB_VERSION = '1';
    const DIGITS = 6;
    const PERIOD = 30;
    const BACKUP_CODES = 10;
    const DAYS_ALLOWED = [0, 1, 7, 30];

    public static function t($n = 'mfa')
    {
        return ZNK_DB::t($n);
    }

    public static function init()
    {
        if (get_option('znk_mfa_db') !== self::DB_VERSION) {
            self::install();
        }
        add_action('rest_api_init', [__CLASS__, 'routes']);
    }

    public static function install()
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $c = $wpdb->get_charset_collate();
        $m = self::t('mfa');
        $d = self::t('mfa_devices');
        dbDelta("CREATE TABLE $m (
  user_id BIGINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  secret TEXT NULL,
  pending TEXT NULL,
  backup TEXT NULL,
  days INT NOT NULL DEFAULT 30,
  last_step BIGINT UNSIGNED NOT NULL DEFAULT 0,
  fails INT NOT NULL DEFAULT 0,
  next_try_at DATETIME NULL,
  enabled_at DATETIME NULL,
  PRIMARY KEY  (user_id)
) $c;");
        dbDelta("CREATE TABLE $d (
  device_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  trusted_until DATETIME NOT NULL,
  PRIMARY KEY  (device_id),
  KEY user_id (user_id)
) $c;");
        update_option('znk_mfa_db', self::DB_VERSION);
    }

    public static function drop()
    {
        global $wpdb;
        $wpdb->query('DROP TABLE IF EXISTS ' . self::t('mfa'));
        $wpdb->query('DROP TABLE IF EXISTS ' . self::t('mfa_devices'));
        delete_option('znk_mfa_db');
    }

    public static function delete_user($uid)
    {
        global $wpdb;
        $wpdb->delete(self::t('mfa'), ['user_id' => (int) $uid]);
        $wpdb->delete(self::t('mfa_devices'), ['user_id' => (int) $uid]);
    }

    // ===================== TOTP =====================

    const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function b32_encode($bin)
    {
        $bits = '';
        foreach (str_split($bin) as $ch) {
            $bits .= str_pad(decbin(ord($ch)), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            $out .= self::B32[bindec(str_pad($chunk, 5, '0'))];
        }
        return $out;
    }

    public static function b32_decode($s)
    {
        $s = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', (string) $s));
        $bits = '';
        foreach (str_split($s) as $ch) {
            $bits .= str_pad(decbin(strpos(self::B32, $ch)), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $chunk) {
            if (strlen($chunk) === 8) {
                $out .= chr(bindec($chunk));
            }
        }
        return $out;
    }

    /** Codice per un dato passo temporale (RFC 4226 / 6238). */
    public static function code($secret_bin, $step)
    {
        $msg = pack('N2', ($step >> 32) & 0xFFFFFFFF, $step & 0xFFFFFFFF);
        $h = hash_hmac('sha1', $msg, $secret_bin, true);
        $o = ord($h[19]) & 0x0F;
        $n = ((ord($h[$o]) & 0x7F) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
        return str_pad((string) ($n % (10 ** self::DIGITS)), self::DIGITS, '0', STR_PAD_LEFT);
    }

    /** @return int passo corrispondente; 0 se il codice non è valido; -1 se è giusto ma già usato. Accetta ±1 passo di scarto. */
    public static function match($secret_bin, $otp, $after_step = 0, $now = null)
    {
        $otp = preg_replace('/\s+/', '', (string) $otp);
        if (!preg_match('/^\d{' . self::DIGITS . '}$/', $otp)) {
            return 0;
        }
        $cur = intdiv($now === null ? time() : (int) $now, self::PERIOD);
        $found = 0;
        foreach ([$cur - 1, $cur, $cur + 1] as $st) {
            // Confronto a tempo costante su tutti i passi; un codice già usato non vale più.
            if (hash_equals(self::code($secret_bin, $st), $otp)) {
                $found = $st > $after_step ? $st : ($found ?: -1);
            }
        }
        return $found;
    }

    // ===================== Stato =====================

    private static function key($uid)
    {
        return ZNK_Secret::key_for('mfa|' . (int) $uid);
    }

    public static function row($uid)
    {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('mfa') . ' WHERE user_id = %d', $uid));
    }

    public static function is_on($uid)
    {
        $r = self::row($uid);
        return $r && (int) $r->enabled === 1 && !empty($r->secret);
    }

    private static function trusted_until($device_id)
    {
        global $wpdb;
        $v = $wpdb->get_var($wpdb->prepare('SELECT trusted_until FROM ' . self::t('mfa_devices') . ' WHERE device_id = %d', $device_id));
        return $v && strtotime($v . ' UTC') > time() ? $v : null;
    }

    private static function trust($dev, $days)
    {
        global $wpdb;
        if ($days <= 0) {
            $wpdb->delete(self::t('mfa_devices'), ['device_id' => (int) $dev->id]);
            return;
        }
        $wpdb->replace(self::t('mfa_devices'), [
            'device_id' => (int) $dev->id,
            'user_id' => (int) $dev->user_id,
            'trusted_until' => gmdate('Y-m-d H:i:s', time() + $days * DAY_IN_SECONDS),
        ]);
    }

    public static function disable($uid, $notify = '')
    {
        global $wpdb;
        $was = self::is_on($uid);
        $wpdb->delete(self::t('mfa'), ['user_id' => (int) $uid]);
        $wpdb->delete(self::t('mfa_devices'), ['user_id' => (int) $uid]);
        if ($was && $notify) {
            ZNK_Users::notify($uid, 'verifica in due passaggi spenta', $notify);
        }
    }

    // ===================== Limite ai tentativi =====================

    private static function wait_error($r)
    {
        if ($r && !empty($r->next_try_at)) {
            $wait = strtotime($r->next_try_at . ' UTC') - time();
            if ($wait > 0) {
                return new WP_Error('znk_wait', 'Troppi codici errati. Riprova tra ' . ZNK_Auth::human_wait($wait) . '.', ['status' => 429, 'retry_after' => $wait]);
            }
        }
        return null;
    }

    /** Prenota un tentativo in modo atomico (stessa scala di attese della password). */
    private static function reserve($uid)
    {
        global $wpdb;
        $t = self::t('mfa');
        $n = $wpdb->query($wpdb->prepare(
            "UPDATE $t SET next_try_at = CASE
                 WHEN fails + 1 >= 10 THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL %d SECOND)
                 WHEN fails + 1 >= 5 THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL LEAST(30 * POW(2, fails + 1 - 5), %d) SECOND)
                 ELSE NULL END,
               fails = LAST_INSERT_ID(fails + 1)
             WHERE user_id = %d AND (next_try_at IS NULL OR next_try_at <= UTC_TIMESTAMP())",
            HOUR_IN_SECONDS,
            30 * MINUTE_IN_SECONDS,
            $uid
        ));
        if (!$n) {
            return self::wait_error(self::row($uid)) ?: new WP_Error('znk_wait', 'Troppi tentativi in corso: riprova tra poco.', ['status' => 429, 'retry_after' => 5]);
        }
        return (int) $wpdb->get_var('SELECT LAST_INSERT_ID()');
    }

    private static function norm_backup($s)
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string) $s));
    }

    /**
     * Controlla un codice (6 cifre dell'app oppure codice di riserva) per l'utente.
     * @return null|WP_Error
     */
    public static function verify($uid, $otp, $secret_enc = null)
    {
        global $wpdb;
        $r = self::row($uid);
        if (!$r) {
            return new WP_Error('znk_mfa_off', 'Verifica in due passaggi non attiva.', ['status' => 409]);
        }
        if ($e = self::wait_error($r)) {
            return $e;
        }
        $n = self::reserve($uid);
        if (is_wp_error($n)) {
            return $n;
        }
        $ok = false;
        $used = false;
        $otp = is_string($otp) ? trim($otp) : '';
        $enc = $secret_enc !== null ? $secret_enc : $r->secret;
        $bin = $enc ? ZNK_Secret::decrypt($enc, self::key($uid)) : false;
        if ($bin && preg_match('/^[\d\s]{6,8}$/', $otp)) {
            $step = self::match($bin, $otp, (int) $r->last_step);
            $used = $step === -1;
            if ($step > 0) {
                // Il passo usato viene registrato solo se è ancora più recente: lo stesso codice non vale due volte.
                $ok = (bool) $wpdb->query($wpdb->prepare('UPDATE ' . self::t('mfa') . ' SET last_step = %d WHERE user_id = %d AND last_step < %d', $step, $uid, $step));
            }
        } elseif ($secret_enc === null && strlen(self::norm_backup($otp)) === 10) {
            $list = json_decode((string) $r->backup, true) ?: [];
            $h = hash_hmac('sha256', self::norm_backup($otp), self::key($uid));
            $i = array_search($h, $list, true);
            if ($i !== false) {
                unset($list[$i]);
                // Consumo atomico: riesce solo se l'elenco non è cambiato nel frattempo.
                $ok = (bool) $wpdb->query($wpdb->prepare('UPDATE ' . self::t('mfa') . ' SET backup = %s WHERE user_id = %d AND backup = %s', wp_json_encode(array_values($list)), $uid, $r->backup));
                if ($ok && count($list) <= 2) {
                    ZNK_Users::notify($uid, 'codici di riserva quasi finiti', 'Ti restano ' . count($list) . ' codici di riserva per la verifica in due passaggi. Creane di nuovi da Impostazioni › Sicurezza.');
                }
            }
        }
        if (!$ok) {
            $wait = ZNK_Auth::wait_for($n);
            if ($n === 10 || ($n > 10 && $n % 5 === 0)) {
                ZNK_Users::notify($uid, 'troppi codici di verifica errati', "Sono stati inseriti $n codici errati per la verifica in due passaggi del tuo spazio ZNoteKeeper, dopo una password corretta.\n\nSe non sei stato tu, cambia subito la password delle note e scollega i dispositivi che non riconosci.");
            }
            return new WP_Error('znk_mfa_bad', ($used ? 'Questo codice è già stato usato: aspetta il prossimo (cambia ogni 30 secondi).' : 'Codice non corretto.') . ($wait ? ' Riprova tra ' . ZNK_Auth::human_wait($wait) . '.' : ''), ['status' => 403, 'retry_after' => $wait]);
        }
        $wpdb->update(self::t('mfa'), ['fails' => 0, 'next_try_at' => null], ['user_id' => (int) $uid]);
        return null;
    }

    /**
     * Da chiamare negli sblocchi, DOPO aver verificato password/PIN/chiave e PRIMA
     * di consegnare cassaforte e sessione. @return null|WP_Error
     */
    public static function gate($req, $ctx)
    {
        $uid = (int) $ctx['user']->user_id;
        $r = self::row($uid);
        if (!$r || !(int) $r->enabled || empty($r->secret)) {
            return null;
        }
        $days = (int) $r->days;
        if ($days > 0 && self::trusted_until($ctx['device']->id)) {
            return null;
        }
        $p = $req->get_json_params();
        $otp = is_array($p) && isset($p['otp']) && is_string($p['otp']) && strlen($p['otp']) <= 40 ? $p['otp'] : '';
        if ($otp === '') {
            return new WP_Error('znk_mfa_required', 'Serve il codice della verifica in due passaggi.', ['status' => 401]);
        }
        if ($e = self::verify($uid, $otp)) {
            return $e;
        }
        self::trust($ctx['device'], $days);
        return null;
    }

    // ===================== API (app sbloccata) =====================

    private static function r($route, $methods, $cb)
    {
        register_rest_route(ZNK_REST::NS, $route, [
            'methods' => $methods,
            'callback' => function ($req) use ($cb) {
                $ctx = ZNK_Auth::session_from_request($req);
                if (is_wp_error($ctx)) {
                    return $ctx;
                }
                return call_user_func([__CLASS__, $cb], $req, $ctx);
            },
            'permission_callback' => '__return_true', // il controllo vero è la sessione dell'app
        ]);
    }

    public static function routes()
    {
        self::r('/mfa', 'GET', 'status');
        self::r('/mfa/start', 'POST', 'start');
        self::r('/mfa/enable', 'POST', 'enable');
        self::r('/mfa/disable', 'POST', 'turn_off');
        self::r('/mfa/backup', 'POST', 'new_backup');
        self::r('/mfa/days', 'POST', 'set_days');
    }

    private static function s($req, $k, $max = 200)
    {
        $p = $req->get_json_params();
        $v = is_array($p) && isset($p[$k]) ? $p[$k] : '';
        return is_string($v) && strlen($v) <= $max ? $v : '';
    }

    private static function password($req, $ctx)
    {
        $u = $ctx['user'];
        return ZNK_Auth::verify_user_secret($u, self::s($req, 'auth'), $u->pw_auth);
    }

    public static function status($req, $ctx)
    {
        $uid = (int) $ctx['user']->user_id;
        $r = self::row($uid);
        $on = $r && (int) $r->enabled === 1;
        $tu = $on ? self::trusted_until($ctx['device']->id) : null;
        return [
            'on' => $on,
            'days' => $r ? (int) $r->days : 30,
            'backup_left' => $on ? count(json_decode((string) $r->backup, true) ?: []) : 0,
            'enabled_at' => $on && $r->enabled_at ? $r->enabled_at . 'Z' : null,
            'trusted_until' => $tu ? $tu . 'Z' : null,
        ];
    }

    /** Primo passo: crea un segreto in attesa di conferma (serve la password delle note). */
    public static function start($req, $ctx)
    {
        global $wpdb;
        if ($e = self::password($req, $ctx)) {
            return $e;
        }
        $uid = (int) $ctx['user']->user_id;
        if (self::is_on($uid)) {
            return new WP_Error('znk_mfa_on', 'La verifica in due passaggi è già attiva.', ['status' => 409]);
        }
        $bin = random_bytes(20);
        $enc = ZNK_Secret::encrypt($bin, self::key($uid));
        if (!$enc) {
            return new WP_Error('znk_mfa', 'Impossibile creare il segreto.', ['status' => 500]);
        }
        if (self::row($uid)) {
            $wpdb->update(self::t('mfa'), ['pending' => $enc, 'fails' => 0, 'next_try_at' => null], ['user_id' => $uid]);
        } else {
            $wpdb->insert(self::t('mfa'), ['user_id' => $uid, 'enabled' => 0, 'pending' => $enc, 'days' => 30]);
        }
        $wp = get_userdata($uid);
        $issuer = 'ZNoteKeeper ' . wp_parse_url(home_url('/'), PHP_URL_HOST);
        $b32 = self::b32_encode($bin);
        $uri = 'otpauth://totp/' . rawurlencode($issuer . ':' . $wp->user_login) . '?secret=' . $b32 . '&issuer=' . rawurlencode($issuer) . '&algorithm=SHA1&digits=' . self::DIGITS . '&period=' . self::PERIOD;
        return ['secret' => $b32, 'uri' => $uri];
    }

    private static function make_backup($uid)
    {
        $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        $plain = [];
        $hashes = [];
        for ($i = 0; $i < self::BACKUP_CODES; $i++) {
            $c = '';
            for ($j = 0; $j < 10; $j++) {
                $c .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            $plain[] = substr($c, 0, 5) . '-' . substr($c, 5);
            $hashes[] = hash_hmac('sha256', $c, self::key($uid));
        }
        return [$plain, wp_json_encode($hashes)];
    }

    /** Secondo passo: il primo codice corretto attiva la verifica e restituisce i codici di riserva. */
    public static function enable($req, $ctx)
    {
        global $wpdb;
        $uid = (int) $ctx['user']->user_id;
        $r = self::row($uid);
        if (!$r || empty($r->pending)) {
            return new WP_Error('znk_mfa', 'Ricomincia l\'attivazione.', ['status' => 409]);
        }
        if ((int) $r->enabled) {
            return new WP_Error('znk_mfa_on', 'La verifica in due passaggi è già attiva.', ['status' => 409]);
        }
        if ($e = self::verify($uid, self::s($req, 'otp', 40), $r->pending)) {
            return $e;
        }
        list($plain, $hashes) = self::make_backup($uid);
        $wpdb->update(self::t('mfa'), [
            'enabled' => 1, 'secret' => $r->pending, 'pending' => null, 'backup' => $hashes, 'enabled_at' => ZNK_DB::now(),
        ], ['user_id' => $uid]);
        self::trust($ctx['device'], (int) $r->days);
        ZNK_Users::notify($uid, 'verifica in due passaggi attivata', "Da ora per aprire le note serve anche il codice della tua app di autenticazione.\n\nSe perdi il telefono usa un codice di riserva, oppure il codice di recupero di 24 caratteri (che spegne la verifica).\n\nSe non sei stato tu, cambia subito la password delle note.");
        return ['backup' => $plain];
    }

    public static function turn_off($req, $ctx)
    {
        if ($e = self::password($req, $ctx)) {
            return $e;
        }
        $uid = (int) $ctx['user']->user_id;
        if (self::is_on($uid)) {
            if ($e = self::verify($uid, self::s($req, 'otp', 40))) {
                return $e;
            }
        }
        self::disable($uid, "La verifica in due passaggi è stata spenta da un tuo dispositivo.\n\nSe non sei stato tu, cambia subito la password delle note e scollega i dispositivi che non riconosci.");
        return ['on' => false];
    }

    public static function new_backup($req, $ctx)
    {
        global $wpdb;
        if ($e = self::password($req, $ctx)) {
            return $e;
        }
        $uid = (int) $ctx['user']->user_id;
        if (!self::is_on($uid)) {
            return new WP_Error('znk_mfa_off', 'Verifica in due passaggi non attiva.', ['status' => 409]);
        }
        if ($e = self::verify($uid, self::s($req, 'otp', 40))) {
            return $e;
        }
        list($plain, $hashes) = self::make_backup($uid);
        $wpdb->update(self::t('mfa'), ['backup' => $hashes], ['user_id' => $uid]);
        return ['backup' => $plain];
    }

    public static function set_days($req, $ctx)
    {
        global $wpdb;
        if ($e = self::password($req, $ctx)) {
            return $e;
        }
        $uid = (int) $ctx['user']->user_id;
        $p = $req->get_json_params();
        $days = is_array($p) && isset($p['days']) ? (int) $p['days'] : -1;
        if (!in_array($days, self::DAYS_ALLOWED, true) || !self::is_on($uid)) {
            return new WP_Error('znk_bad', 'Valore non valido.', ['status' => 400]);
        }
        $wpdb->update(self::t('mfa'), ['days' => $days], ['user_id' => $uid]);
        // Cambiare la durata azzera la fiducia degli altri dispositivi; questo resta fidato per la nuova durata.
        $wpdb->delete(self::t('mfa_devices'), ['user_id' => $uid]);
        self::trust($ctx['device'], $days);
        return self::status($req, $ctx);
    }
}

<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Dispositivi collegati e sessioni di sblocco.
 *
 * - Un dispositivo si collega una volta, dopo l'accesso a WordPress, e riceve un
 *   token lungo (180 giorni, rinnovato a ogni uso): l'app installata non chiede
 *   ogni volta l'accesso al sito (punto 34).
 * - Le operazioni sui dati richiedono anche una sessione di sblocco, rilasciata
 *   solo dopo la prova della password (o del PIN, o della chiave dello spazio).
 */
class ZNK_Auth
{
    const DEVICE_TTL = 180 * DAY_IN_SECONDS;
    const SESSION_TTL = 12 * HOUR_IN_SECONDS;

    public static function header($r, $name)
    {
        $v = $r->get_header($name);
        return is_string($v) ? trim($v) : '';
    }

    public static function device_from_request($r)
    {
        global $wpdb;
        $tok = self::header($r, 'x_znk_token');
        if ($tok === '' || strlen($tok) > 200) {
            return new WP_Error('znk_no_device', 'Dispositivo non collegato.', ['status' => 401]);
        }
        $dev = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . ZNK_DB::t('devices') . ' WHERE token_hash = %s', ZNK_Secret::hash($tok)));
        if (!$dev) {
            return new WP_Error('znk_no_device', 'Dispositivo non collegato.', ['status' => 401]);
        }
        if (strtotime($dev->last_seen . ' UTC') < time() - self::DEVICE_TTL) {
            $wpdb->delete(ZNK_DB::t('devices'), ['id' => $dev->id]);
            return new WP_Error('znk_no_device', 'Collegamento scaduto.', ['status' => 401]);
        }
        $user = ZNK_Users::get($dev->user_id);
        if (!$user || !(int) $user->enabled || !get_userdata($dev->user_id)) {
            return new WP_Error('znk_disabled', 'Il tuo utente non è abilitato a ZNoteKeeper.', ['status' => 403]);
        }
        if (strtotime($dev->last_seen . ' UTC') < time() - 600) {
            $wpdb->update(ZNK_DB::t('devices'), ['last_seen' => ZNK_DB::now()], ['id' => $dev->id]);
        }
        return ['device' => $dev, 'user' => $user];
    }

    /** Dispositivo + sessione di sblocco valida. */
    public static function session_from_request($r)
    {
        global $wpdb;
        $ctx = self::device_from_request($r);
        if (is_wp_error($ctx)) {
            return $ctx;
        }
        $s = self::header($r, 'x_znk_session');
        $dev = $ctx['device'];
        if ($s === '' || empty($dev->session_hash) || !hash_equals($dev->session_hash, ZNK_Secret::hash($s))) {
            return new WP_Error('znk_locked', 'App bloccata: sblocca di nuovo.', ['status' => 401]);
        }
        if (strtotime($dev->session_exp . ' UTC') < time()) {
            return new WP_Error('znk_locked', 'Sessione scaduta: sblocca di nuovo.', ['status' => 401]);
        }
        // Rinnovo scorrevole.
        if (strtotime($dev->session_exp . ' UTC') < time() + self::SESSION_TTL - 900) {
            $wpdb->update(ZNK_DB::t('devices'), ['session_exp' => gmdate('Y-m-d H:i:s', time() + self::SESSION_TTL)], ['id' => $dev->id]);
        }
        return $ctx;
    }

    public static function create_device($user_id, $name)
    {
        global $wpdb;
        $tok = ZNK_Secret::token(32);
        $now = ZNK_DB::now();
        $wpdb->insert(ZNK_DB::t('devices'), [
            'user_id' => (int) $user_id,
            'token_hash' => ZNK_Secret::hash($tok),
            'name' => mb_substr(sanitize_text_field($name), 0, 180),
            'created_at' => $now,
            'last_seen' => $now,
        ]);
        return $tok;
    }

    public static function issue_session($dev)
    {
        global $wpdb;
        $s = ZNK_Secret::token(32);
        $wpdb->update(ZNK_DB::t('devices'), [
            'session_hash' => ZNK_Secret::hash($s),
            'session_exp' => gmdate('Y-m-d H:i:s', time() + self::SESSION_TTL),
        ], ['id' => $dev->id]);
        return $s;
    }

    public static function end_session($dev)
    {
        global $wpdb;
        $wpdb->update(ZNK_DB::t('devices'), ['session_hash' => null, 'session_exp' => null], ['id' => $dev->id]);
    }

    // ---------- Limite ai tentativi (punto 5) ----------

    /** Restituisce WP_Error se l'utente deve attendere prima di riprovare. */
    public static function throttle($user)
    {
        if (!empty($user->next_try_at)) {
            $wait = strtotime($user->next_try_at . ' UTC') - time();
            if ($wait > 0) {
                return new WP_Error('znk_wait', 'Troppi tentativi errati. Riprova tra ' . self::human_wait($wait) . '.', ['status' => 429, 'retry_after' => $wait]);
            }
        }
        return null;
    }

    public static function human_wait($s)
    {
        if ($s < 90) {
            return $s . ' secondi';
        }
        if ($s < 5400) {
            return ceil($s / 60) . ' minuti';
        }
        return ceil($s / 3600) . ' ore';
    }

    public static function register_fail($user, $msg = 'Password non corretta.')
    {
        $fails = (int) $user->fails + 1;
        $wait = 0;
        if ($fails >= 10) {
            $wait = HOUR_IN_SECONDS;
        } elseif ($fails >= 5) {
            $wait = min(30 * (2 ** ($fails - 5)), 30 * MINUTE_IN_SECONDS);
        }
        ZNK_Users::update($user->user_id, [
            'fails' => $fails,
            'next_try_at' => $wait ? gmdate('Y-m-d H:i:s', time() + $wait) : null,
        ]);
        if ($fails === 10 || ($fails > 10 && $fails % 5 === 0)) {
            ZNK_Users::notify(
                $user->user_id,
                'troppi tentativi di sblocco',
                "Sono stati inseriti $fails tentativi errati di password o codice di recupero per il tuo spazio ZNoteKeeper. "
                . "Lo sblocco è sospeso per un'ora a ogni nuovo errore.\n\nSe non sei stato tu, cambia la password del tuo utente WordPress e scollega i dispositivi da Impostazioni › Sicurezza."
            );
        }
        $left = $fails < 5 ? 5 - $fails : 0;
        if ($left > 0 && $left <= 2) {
            $msg .= " Ancora $left tentativ" . ($left === 1 ? 'o' : 'i') . ' prima dell\'attesa.';
        } elseif ($wait) {
            $msg .= ' Riprova tra ' . self::human_wait($wait) . '.';
        }
        return new WP_Error('znk_bad_secret', $msg, ['status' => 403, 'retry_after' => $wait]);
    }

    public static function reset_fails($user)
    {
        if ((int) $user->fails || !empty($user->next_try_at)) {
            ZNK_Users::update($user->user_id, ['fails' => 0, 'next_try_at' => null]);
        }
    }

    public static function check_secret($given, $hash)
    {
        return is_string($given) && $given !== '' && !empty($hash) && password_verify($given, $hash);
    }

    public static function hash_secret($given)
    {
        return password_hash($given, PASSWORD_DEFAULT);
    }
}

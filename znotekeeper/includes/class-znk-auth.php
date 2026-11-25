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

    /** Attesa (secondi) dopo il tentativo errato numero $fails. */
    public static function wait_for($fails)
    {
        if ($fails >= 10) {
            return HOUR_IN_SECONDS;
        }
        if ($fails >= 5) {
            return min(30 * (2 ** ($fails - 5)), 30 * MINUTE_IN_SECONDS);
        }
        return 0;
    }

    /**
     * Prenota un tentativo in modo atomico, PRIMA di controllare il segreto:
     * il contatore sale e l'eventuale attesa parte subito, così molte richieste
     * in parallelo non possono provare più segreti di quanti ne consenta il limite.
     * Un tentativo riuscito azzera tutto con reset_fails().
     *
     * @return int|WP_Error numero del tentativo prenotato
     */
    public static function reserve_attempt($user)
    {
        global $wpdb;
        $t = ZNK_DB::t('users');
        $n = $wpdb->query($wpdb->prepare(
            // next_try_at prima di fails: MySQL valuta le assegnazioni da sinistra a destra.
            "UPDATE $t SET next_try_at = CASE
                 WHEN fails + 1 >= 10 THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL %d SECOND)
                 WHEN fails + 1 >= 5 THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL LEAST(30 * POW(2, fails + 1 - 5), %d) SECOND)
                 ELSE NULL END,
               fails = LAST_INSERT_ID(fails + 1)
             WHERE user_id = %d AND (next_try_at IS NULL OR next_try_at <= UTC_TIMESTAMP())",
            HOUR_IN_SECONDS,
            30 * MINUTE_IN_SECONDS,
            $user->user_id
        ));
        if (!$n) {
            $fresh = ZNK_Users::get($user->user_id);
            $e = $fresh ? self::throttle($fresh) : null;
            return $e ?: new WP_Error('znk_wait', 'Troppi tentativi in corso: riprova tra poco.', ['status' => 429, 'retry_after' => 5]);
        }
        return (int) $wpdb->get_var('SELECT LAST_INSERT_ID()');
    }

    /** Messaggio e avvisi dopo un tentativo errato già contato da reserve_attempt(). */
    public static function register_fail($user, $msg = 'Password non corretta.', $fails = null)
    {
        $fails = $fails === null ? (int) $user->fails + 1 : (int) $fails;
        $wait = self::wait_for($fails);
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

    /** Verifica un segreto dell'utente con il limite ai tentativi. @return null|WP_Error */
    public static function verify_user_secret($user, $given, $hash, $msg = 'Password non corretta.')
    {
        if ($e = self::throttle($user)) {
            return $e;
        }
        $n = self::reserve_attempt($user);
        if (is_wp_error($n)) {
            return $n;
        }
        if (!self::check_secret($given, $hash)) {
            return self::register_fail($user, $msg, $n);
        }
        self::reset_fails($user, true);
        return null;
    }

    public static function reset_fails($user, $force = false)
    {
        if ($force || (int) $user->fails || !empty($user->next_try_at)) {
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

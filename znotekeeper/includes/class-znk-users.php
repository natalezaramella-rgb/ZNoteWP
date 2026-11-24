<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Utenti abilitati e loro "cassaforte" (vault). Il server conserva solo
 * chiavi già chiuse nel browser e impronte (hash) delle prove di sblocco.
 */
class ZNK_Users
{
    public static function init()
    {
        // Se cambiano email o password WordPress, il recupero via email si spegne (punto 1 della revisione).
        add_action('profile_update', [__CLASS__, 'on_profile_update'], 10, 2);
        add_action('after_password_reset', function ($user) {
            self::disable_email_recovery($user->ID, 'password');
        });
        add_action('wp_set_password', function ($password, $user_id) {
            self::disable_email_recovery($user_id, 'password');
        }, 10, 2);
        add_action('deleted_user', [__CLASS__, 'delete_space']);
    }

    public static function get($user_id)
    {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . ZNK_DB::t('users') . ' WHERE user_id = %d', $user_id));
    }

    public static function is_enabled($user_id)
    {
        $u = self::get($user_id);
        return $u && (int) $u->enabled === 1;
    }

    public static function update($user_id, array $fields)
    {
        global $wpdb;
        $fields['updated_at'] = ZNK_DB::now();
        return $wpdb->update(ZNK_DB::t('users'), $fields, ['user_id' => (int) $user_id]);
    }

    public static function set_enabled($user_id, $on)
    {
        global $wpdb;
        $row = self::get($user_id);
        $now = ZNK_DB::now();
        if (!$row) {
            if (!$on) {
                return;
            }
            $wpdb->insert(ZNK_DB::t('users'), [
                'user_id' => (int) $user_id,
                'enabled' => 1,
                'enabled_at' => $now,
                'inbox_token' => self::new_inbox_token(),
                'sender_salt' => bin2hex(random_bytes(16)),
                'senders' => '[]',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            self::send_invite($user_id);
            return;
        }
        $fields = ['enabled' => $on ? 1 : 0];
        if ($on && !(int) $row->enabled) {
            $fields['enabled_at'] = $now;
        }
        self::update($user_id, $fields);
        if (!$on) {
            // Scollega subito tutti i dispositivi.
            $wpdb->delete(ZNK_DB::t('devices'), ['user_id' => (int) $user_id]);
        } elseif (!(int) $row->enabled && empty($row->vault)) {
            self::send_invite($user_id);
        }
    }

    public static function new_inbox_token()
    {
        $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
        $s = '';
        for ($i = 0; $i < 10; $i++) {
            $s .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return $s;
    }

    /** Cancella definitivamente lo spazio dell'utente (dati e dispositivi). */
    public static function delete_space($user_id)
    {
        global $wpdb;
        $uid = (int) $user_id;
        foreach (['items', 'versions', 'inbox', 'devices', 'users'] as $t) {
            $wpdb->delete(ZNK_DB::t($t), ['user_id' => $uid]);
        }
    }

    public static function usage($user_id)
    {
        global $wpdb;
        $r = $wpdb->get_row($wpdb->prepare(
            'SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM ' . ZNK_DB::t('items') . ' WHERE user_id = %d AND purged = 0',
            $user_id
        ));
        $v = (int) $wpdb->get_var($wpdb->prepare('SELECT COALESCE(SUM(LENGTH(data)),0) FROM ' . ZNK_DB::t('versions') . ' WHERE user_id = %d', $user_id));
        $d = (int) $wpdb->get_var($wpdb->prepare('SELECT COUNT(*) FROM ' . ZNK_DB::t('devices') . ' WHERE user_id = %d', $user_id));
        return ['items' => (int) $r->n, 'bytes' => (int) $r->bytes + $v, 'devices' => $d];
    }

    public static function app_url()
    {
        return ZNK_App::url('');
    }

    public static function send_invite($user_id)
    {
        $u = get_userdata($user_id);
        if (!$u || !$u->user_email) {
            return;
        }
        $site = wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES);
        $body = "Ciao {$u->display_name},\n\n"
            . "ti è stato dato accesso a ZNoteKeeper, il taccuino riservato di $site.\n\n"
            . "Aprilo da qui, accedi con il tuo utente del sito e scegli la tua password delle note:\n"
            . self::app_url() . "\n\n"
            . "La password delle note è diversa da quella del sito e la conosci solo tu: nemmeno l'amministratore può leggere i tuoi contenuti.\n";
        wp_mail($u->user_email, "[$site] Sei stato abilitato a ZNoteKeeper", $body);
    }

    public static function notify($user_id, $subject, $body)
    {
        $u = get_userdata($user_id);
        if (!$u || !$u->user_email) {
            return;
        }
        $site = wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES);
        wp_mail($u->user_email, "[$site] ZNoteKeeper: $subject", $body . "\n\n" . self::app_url());
    }

    // ---------- Recupero via email ----------

    /** Chiave che lega la copia di recupero all'email e alla password WordPress attuali. */
    public static function er_key($user_id)
    {
        $u = get_userdata($user_id);
        if (!$u) {
            return false;
        }
        return ZNK_Secret::key_for('er|' . (int) $user_id . '|' . strtolower(trim($u->user_email)) . '|' . $u->user_pass);
    }

    public static function email_recovery_state($row)
    {
        if (!$row || empty($row->er_sealed)) {
            return 'off';
        }
        $key = self::er_key($row->user_id);
        if (!$key || ZNK_Secret::decrypt($row->er_sealed, $key) === false) {
            return 'broken';
        }
        if (!empty($row->er_ready_at)) {
            return strtotime($row->er_ready_at . ' UTC') <= time() ? 'ready' : 'pending';
        }
        return 'on';
    }

    public static function disable_email_recovery($user_id, $why = '')
    {
        $row = self::get($user_id);
        if (!$row || empty($row->er_sealed)) {
            return;
        }
        self::update($user_id, [
            'er_sealed' => null, 'er_wrapped' => null, 'er_email' => null,
            'er_token_hash' => null, 'er_token_exp' => null, 'er_ready_at' => null,
        ]);
        if ($why) {
            $msg = $why === 'email'
                ? "L'indirizzo email del tuo utente è cambiato: per sicurezza il recupero via email di ZNoteKeeper è stato spento."
                : "La password del tuo utente WordPress è cambiata: per sicurezza il recupero via email di ZNoteKeeper è stato spento.";
            $msg .= "\n\nPuoi riattivarlo da Impostazioni › Sicurezza dopo aver sbloccato l'app. Il codice di recupero continua a funzionare.";
            self::notify($user_id, 'recupero via email spento', $msg);
            // Avvisa anche il vecchio indirizzo, se diverso.
            if (!empty($row->er_email)) {
                $u = get_userdata($user_id);
                if ($u && strtolower($u->user_email) !== strtolower($row->er_email)) {
                    wp_mail($row->er_email, 'ZNoteKeeper: recupero via email spento', $msg);
                }
            }
        }
    }

    public static function on_profile_update($user_id, $old)
    {
        $new = get_userdata($user_id);
        if (!$new || !$old) {
            return;
        }
        if (strtolower($new->user_email) !== strtolower($old->user_email)) {
            self::disable_email_recovery($user_id, 'email');
        } elseif ($new->user_pass !== $old->user_pass) {
            self::disable_email_recovery($user_id, 'password');
        }
    }

    // ---------- Mittenti ammessi (impronte, non indirizzi in chiaro) ----------

    public static function sender_hash($row, $email)
    {
        return hash_hmac('sha256', strtolower(trim($email)), (string) $row->sender_salt);
    }

    public static function mask_email($email)
    {
        $email = strtolower(trim($email));
        $at = strpos($email, '@');
        if ($at === false) {
            return '•••';
        }
        $local = substr($email, 0, $at);
        $dom = substr($email, $at + 1);
        return substr($local, 0, 1) . str_repeat('•', max(2, min(6, strlen($local) - 1))) . '@' . $dom;
    }
}

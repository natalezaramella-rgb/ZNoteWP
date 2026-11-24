<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Pannello WordPress: Utenti › ZNoteKeeper. L'amministratore abilita o
 * disabilita gli utenti, cancella uno spazio e configura la casella email.
 * Non vede mai titoli né contenuti.
 */
class ZNK_Admin
{
    public static function init()
    {
        add_action('admin_menu', function () {
            add_users_page('ZNoteKeeper', 'ZNoteKeeper', 'manage_options', 'znotekeeper', [__CLASS__, 'page']);
        });
        add_action('admin_post_znk_user', [__CLASS__, 'handle_user']);
        add_action('admin_post_znk_mail', [__CLASS__, 'handle_mail']);
        add_action('admin_post_znk_mail_check', [__CLASS__, 'handle_mail_check']);
        add_filter('plugin_action_links_' . plugin_basename(ZNK_FILE), function ($links) {
            array_unshift($links, '<a href="' . esc_url(admin_url('users.php?page=znotekeeper')) . '">Utenti</a>');
            $links[] = '<a href="' . esc_url(ZNK_App::url('')) . '">Apri app</a>';
            return $links;
        });
    }

    private static function back($args = [])
    {
        wp_safe_redirect(add_query_arg($args, admin_url('users.php?page=znotekeeper' . (isset($args['tab']) ? '' : ''))));
        exit;
    }

    public static function handle_user()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Non autorizzato.');
        }
        check_admin_referer('znk_user');
        $uid = isset($_POST['user_id']) ? (int) $_POST['user_id'] : 0;
        $op = isset($_POST['op']) ? sanitize_key($_POST['op']) : '';
        $u = get_userdata($uid);
        if (!$u) {
            self::back(['znk_msg' => 'nouser']);
        }
        if ($op === 'enable') {
            ZNK_Users::set_enabled($uid, true);
            self::back(['znk_msg' => 'enabled']);
        } elseif ($op === 'disable') {
            ZNK_Users::set_enabled($uid, false);
            self::back(['znk_msg' => 'disabled']);
        } elseif ($op === 'delete') {
            $confirm = isset($_POST['confirm']) ? sanitize_text_field(wp_unslash($_POST['confirm'])) : '';
            if ($confirm !== $u->user_login) {
                self::back(['znk_msg' => 'confirm']);
            }
            ZNK_Users::delete_space($uid);
            self::back(['znk_msg' => 'deleted']);
        }
        self::back();
    }

    public static function handle_mail()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Non autorizzato.');
        }
        check_admin_referer('znk_mail');
        $in = wp_unslash($_POST);
        $cfg = ZNK_Mail::settings();
        $cfg['mode'] = in_array($in['mode'] ?? '', ['off', 'imap', 'webhook'], true) ? $in['mode'] : 'off';
        $cfg['address'] = sanitize_email($in['address'] ?? '');
        $cfg['host'] = sanitize_text_field($in['host'] ?? '');
        $cfg['port'] = max(1, min(65535, (int) ($in['port'] ?? 993)));
        $cfg['secure'] = in_array($in['secure'] ?? '', ['ssl', 'tls', 'none'], true) ? $in['secure'] : 'ssl';
        $cfg['user'] = sanitize_text_field($in['user'] ?? '');
        $cfg['folder'] = sanitize_text_field($in['folder'] ?? 'INBOX') ?: 'INBOX';
        if (!empty($in['pass'])) {
            $cfg['pass'] = ZNK_Secret::encrypt((string) $in['pass'], ZNK_Secret::key_for('imap'));
        }
        if (!empty($in['regen_secret']) || empty($cfg['webhook_secret'])) {
            $cfg['webhook_secret'] = ZNK_Secret::token(24);
        }
        update_option('znk_mail', $cfg, false);
        update_option('znk_mail_auth_check', empty($in['auth_check']) ? 0 : 1);
        update_option('znk_mail_rate', max(1, min(500, (int) ($in['rate'] ?? 30))));
        self::back(['znk_msg' => 'mailsaved', 'tab' => 'mail']);
    }

    public static function handle_mail_check()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Non autorizzato.');
        }
        check_admin_referer('znk_mail_check');
        $r = ZNK_Mail::poll(true);
        set_transient('znk_mail_check_result', $r, 300);
        self::back(['znk_msg' => 'checked', 'tab' => 'mail']);
    }

    private static function size($b)
    {
        if ($b < 1024) {
            return $b . ' B';
        }
        if ($b < 1048576) {
            return round($b / 1024) . ' KB';
        }
        return round($b / 1048576, 1) . ' MB';
    }

    public static function page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        global $wpdb;
        $tab = isset($_GET['tab']) && $_GET['tab'] === 'mail' ? 'mail' : 'users';
        $msgs = [
            'enabled' => 'Utente abilitato. Riceverà un\'email di invito.',
            'disabled' => 'Utente disabilitato: i suoi dispositivi sono stati scollegati. I dati restano cifrati.',
            'deleted' => 'Spazio cancellato definitivamente.',
            'confirm' => 'Per cancellare lo spazio scrivi esattamente il nome utente.',
            'mailsaved' => 'Impostazioni email salvate.',
            'checked' => 'Controllo della casella eseguito.',
            'nouser' => 'Utente non trovato.',
        ];
        $m = isset($_GET['znk_msg']) ? sanitize_key($_GET['znk_msg']) : '';
        echo '<div class="wrap"><h1>ZNoteKeeper</h1>';
        if ($m && isset($msgs[$m])) {
            echo '<div class="notice ' . ($m === 'confirm' ? 'notice-error' : 'notice-success') . ' is-dismissible"><p>' . esc_html($msgs[$m]) . '</p></div>';
        }
        echo '<nav class="nav-tab-wrapper"><a class="nav-tab ' . ($tab === 'users' ? 'nav-tab-active' : '') . '" href="' . esc_url(admin_url('users.php?page=znotekeeper')) . '">Utenti</a>';
        echo '<a class="nav-tab ' . ($tab === 'mail' ? 'nav-tab-active' : '') . '" href="' . esc_url(admin_url('users.php?page=znotekeeper&tab=mail')) . '">Email → nota</a></nav>';

        if ($tab === 'mail') {
            self::mail_tab();
            echo '</div>';
            return;
        }

        echo '<p style="max-width:760px">Abilita gli utenti che possono usare ZNoteKeeper. Ogni utente ha uno spazio separato, chiuso con una password che sceglie lui: puoi abilitarlo, disabilitarlo o cancellarne lo spazio, ma non aprirlo né reimpostarne la password. <a href="' . esc_url(ZNK_App::url('')) . '" target="_blank" rel="noopener">Apri l\'app ↗</a></p>';
        $rows = $wpdb->get_results('SELECT * FROM ' . ZNK_DB::t('users'), OBJECT_K);
        $users = get_users(['orderby' => 'display_name', 'number' => 500]);
        echo '<table class="widefat striped" style="max-width:1100px"><thead><tr><th>Utente</th><th>Stato</th><th>Abilitato dal</th><th>Spazio</th><th>Recupero email</th><th>Azioni</th></tr></thead><tbody>';
        foreach ($users as $u) {
            $r = isset($rows[$u->ID]) ? $rows[$u->ID] : null;
            $on = $r && (int) $r->enabled;
            echo '<tr><td><strong>' . esc_html($u->display_name) . '</strong><br><span class="description">' . esc_html($u->user_login) . ' · ' . esc_html($u->user_email) . '</span></td>';
            if (!$r) {
                echo '<td>—</td><td>—</td><td>—</td><td>—</td>';
            } else {
                $st = $on ? (empty($r->vault) ? 'Abilitato, primo avvio da fare' : 'Abilitato') : 'Disabilitato';
                $use = ZNK_Users::usage($u->ID);
                echo '<td>' . esc_html($st) . '</td>';
                echo '<td>' . ($r->enabled_at ? esc_html(get_date_from_gmt($r->enabled_at, 'd/m/Y')) : '—') . '</td>';
                echo '<td>' . esc_html($use['items'] . ' elementi · ' . self::size($use['bytes']) . ' · ' . $use['devices'] . ' dispositivi') . '</td>';
                $er = ZNK_Users::email_recovery_state($r);
                $erl = ['off' => 'Spento', 'on' => 'Attivo', 'pending' => 'In attesa (24 h)', 'ready' => 'Pronto', 'broken' => 'Non più valido'];
                echo '<td>' . esc_html($erl[$er]) . '</td>';
            }
            echo '<td>';
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline-block;margin-right:6px">';
            wp_nonce_field('znk_user');
            echo '<input type="hidden" name="action" value="znk_user"><input type="hidden" name="user_id" value="' . (int) $u->ID . '">';
            if ($on) {
                echo '<input type="hidden" name="op" value="disable"><button class="button" onclick="return confirm(\'Disabilitare ' . esc_js($u->display_name) . '? I suoi dispositivi verranno scollegati; i dati restano cifrati e puoi riabilitarlo.\')">Disabilita</button>';
            } else {
                echo '<input type="hidden" name="op" value="enable"><button class="button button-primary">Abilita</button>';
            }
            echo '</form>';
            if ($r) {
                echo '<details style="display:inline-block;vertical-align:top"><summary class="button-link" style="color:#b32d2e;cursor:pointer">Cancella spazio…</summary>';
                echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="margin-top:6px">';
                wp_nonce_field('znk_user');
                echo '<input type="hidden" name="action" value="znk_user"><input type="hidden" name="user_id" value="' . (int) $u->ID . '"><input type="hidden" name="op" value="delete">';
                echo '<p class="description" style="max-width:260px">Cancella per sempre note, attività ed email di questo utente. Scrivi <code>' . esc_html($u->user_login) . '</code> per confermare.</p>';
                echo '<input type="text" name="confirm" autocomplete="off" style="width:160px"> <button class="button button-link-delete">Cancella</button></form></details>';
            }
            echo '</td></tr>';
        }
        echo '</tbody></table></div>';
    }

    private static function mail_tab()
    {
        $c = ZNK_Mail::settings();
        $hook = rest_url('znk/v1/mail/inbound') . '?key=' . rawurlencode($c['webhook_secret'] ?? '');
        $res = get_transient('znk_mail_check_result');
        $last = get_option('znk_mail_last_check');
        echo '<div style="max-width:820px">';
        echo '<p>Ogni utente riceve un indirizzo personale del tipo <code>' . esc_html(ZNK_Mail::example_address()) . '</code>: le email inoltrate lì diventano note cifrate con la chiave pubblica dell\'utente appena arrivano. Il server non può più rileggerle.</p>';
        echo '<p><b>Cosa serve:</b> una casella dedicata (es. <code>note@tuodominio.it</code>) che accetti l\'indirizzamento con il «+» (<code>note+codice@…</code>), oppure un servizio che inoltri le email in arrivo al webhook qui sotto (Cloudflare Email Routing con un Worker, Mailgun Routes, ecc.). I messaggi vengono cancellati dalla casella subito dopo l\'importazione.</p>';
        if ($res) {
            echo '<div class="notice notice-info"><p>' . esc_html($res) . '</p></div>';
        }
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('znk_mail');
        echo '<input type="hidden" name="action" value="znk_mail"><table class="form-table" role="presentation">';
        $sel = function ($v, $cur) {
            return $v === $cur ? ' selected' : '';
        };
        echo '<tr><th>Ricezione</th><td><select name="mode"><option value="off"' . $sel('off', $c['mode']) . '>Spenta</option><option value="imap"' . $sel('imap', $c['mode']) . '>Lettura casella IMAP ogni 5 minuti</option><option value="webhook"' . $sel('webhook', $c['mode']) . '>Webhook (servizio di posta in arrivo)</option></select></td></tr>';
        echo '<tr><th>Indirizzo della casella</th><td><input type="email" class="regular-text" name="address" value="' . esc_attr($c['address']) . '" placeholder="note@tuodominio.it"><p class="description">Gli utenti useranno <code>parte+codice@dominio</code>.</p></td></tr>';
        echo '<tr><th colspan="2"><h3 style="margin:0">IMAP</h3></th></tr>';
        echo '<tr><th>Server</th><td><input class="regular-text" name="host" value="' . esc_attr($c['host']) . '" placeholder="imap.tuodominio.it"> Porta <input type="number" name="port" value="' . (int) $c['port'] . '" style="width:90px"> <select name="secure"><option value="ssl"' . $sel('ssl', $c['secure']) . '>SSL/TLS</option><option value="tls"' . $sel('tls', $c['secure']) . '>STARTTLS</option><option value="none"' . $sel('none', $c['secure']) . '>Nessuna (sconsigliato)</option></select></td></tr>';
        echo '<tr><th>Utente</th><td><input class="regular-text" name="user" value="' . esc_attr($c['user']) . '" autocomplete="off"></td></tr>';
        echo '<tr><th>Password</th><td><input type="password" class="regular-text" name="pass" value="" autocomplete="new-password" placeholder="' . (!empty($c['pass']) ? '•••••••• (salvata, lascia vuoto per non cambiarla)' : '') . '"><p class="description">Conservata cifrata con la chiave del sito.</p></td></tr>';
        echo '<tr><th>Cartella</th><td><input name="folder" value="' . esc_attr($c['folder']) . '"></td></tr>';
        echo '<tr><th colspan="2"><h3 style="margin:0">Webhook</h3></th></tr>';
        echo '<tr><th>URL</th><td><code style="word-break:break-all">' . esc_html($hook) . '</code><p class="description">POST del messaggio grezzo (MIME) nel corpo, oppure nei campi <code>raw</code>, <code>email</code> o <code>body-mime</code>. Il destinatario viene letto dalle intestazioni o dal campo <code>to</code>/<code>recipient</code>.</p><label><input type="checkbox" name="regen_secret" value="1"> Rigenera la chiave del webhook</label></td></tr>';
        echo '<tr><th colspan="2"><h3 style="margin:0">Protezioni</h3></th></tr>';
        echo '<tr><th>Verifica mittente</th><td><label><input type="checkbox" name="auth_check" value="1"' . (get_option('znk_mail_auth_check', 1) ? ' checked' : '') . '> Accetta solo email con SPF, DKIM o DMARC superati per il dominio del mittente</label></td></tr>';
        echo '<tr><th>Limite</th><td><input type="number" name="rate" value="' . (int) get_option('znk_mail_rate', 30) . '" style="width:90px"> email all\'ora per utente</td></tr>';
        echo '</table>';
        submit_button('Salva impostazioni');
        echo '</form>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('znk_mail_check');
        echo '<input type="hidden" name="action" value="znk_mail_check"><p><button class="button">Controlla la casella adesso</button> <span class="description">Ultimo controllo: ' . ($last ? esc_html(get_date_from_gmt(gmdate('Y-m-d H:i:s', strtotime($last)), 'd/m/Y H:i')) : 'mai') . '</span></p></form>';
        $log = get_option('znk_mail_log');
        if (is_array($log) && $log) {
            echo '<h3>Ultimi messaggi</h3><ul style="font-family:monospace;font-size:12px">';
            foreach ($log as $l) {
                echo '<li>' . esc_html($l) . '</li>';
            }
            echo '</ul>';
        }
        echo '<p class="description">WP-Cron parte solo quando qualcuno visita il sito. Per controlli regolari aggiungi un cron di sistema che chiami <code>' . esc_html(site_url('wp-cron.php')) . '</code> ogni 5 minuti.</p>';
        echo '</div>';
    }
}

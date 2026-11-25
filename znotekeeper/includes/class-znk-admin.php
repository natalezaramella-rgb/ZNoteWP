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
        add_action('admin_post_znk_style', [__CLASS__, 'handle_style']);
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

    public static function handle_style()
    {
        if (!current_user_can('manage_options')) {
            wp_die('Non autorizzato.');
        }
        check_admin_referer('znk_style');
        $in = wp_unslash($_POST);
        if (!empty($in['reset'])) {
            delete_option(ZNK_Style::OPT);
        } else {
            ZNK_Style::save($in);
        }
        self::back(['znk_msg' => 'stylesaved', 'tab' => 'style']);
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
        $tab = isset($_GET['tab']) && in_array($_GET['tab'], ['mail', 'style'], true) ? $_GET['tab'] : 'users';
        $msgs = [
            'enabled' => 'Utente abilitato. Riceverà un\'email di invito.',
            'disabled' => 'Utente disabilitato: i suoi dispositivi sono stati scollegati. I dati restano cifrati.',
            'deleted' => 'Spazio cancellato definitivamente.',
            'confirm' => 'Per cancellare lo spazio scrivi esattamente il nome utente.',
            'mailsaved' => 'Impostazioni email salvate.',
            'stylesaved' => 'Aspetto salvato. Gli utenti lo vedono alla prossima apertura dell\'app (a volte serve ricaricare due volte).',
            'checked' => 'Controllo della casella eseguito.',
            'nouser' => 'Utente non trovato.',
        ];
        $m = isset($_GET['znk_msg']) ? sanitize_key($_GET['znk_msg']) : '';
        echo '<div class="wrap"><h1>ZNoteKeeper</h1>';
        if ($m && isset($msgs[$m])) {
            echo '<div class="notice ' . ($m === 'confirm' ? 'notice-error' : 'notice-success') . ' is-dismissible"><p>' . esc_html($msgs[$m]) . '</p></div>';
        }
        echo '<nav class="nav-tab-wrapper"><a class="nav-tab ' . ($tab === 'users' ? 'nav-tab-active' : '') . '" href="' . esc_url(admin_url('users.php?page=znotekeeper')) . '">Utenti</a>';
        echo '<a class="nav-tab ' . ($tab === 'mail' ? 'nav-tab-active' : '') . '" href="' . esc_url(admin_url('users.php?page=znotekeeper&tab=mail')) . '">Email → nota</a>';
        echo '<a class="nav-tab ' . ($tab === 'style' ? 'nav-tab-active' : '') . '" href="' . esc_url(admin_url('users.php?page=znotekeeper&tab=style')) . '">Aspetto</a></nav>';

        if ($tab === 'style') {
            self::style_tab();
            echo '</div>';
            return;
        }

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

    private static function style_tab()
    {
        $s = ZNK_Style::settings();
        $pv = ZNK_Style::preview();
        $d = $pv['r']['detected'];
        $src = $d['src'];
        echo '<div style="max-width:900px">';
        echo '<p>L\'app prende da sola colori e caratteri dal tema del sito (stili globali di theme.json, tavolozza del tema, Astra, GeneratePress, Kadence, OceanWP e Personalizza). Qui puoi controllare cosa ha trovato e correggere i singoli valori: un campo vuoto usa quello del sito. Da questi tre colori l\'app ricava da sola la versione chiara e quella scura, con un contrasto sempre leggibile.</p>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" id="znk-style-form">';
        wp_nonce_field('znk_style');
        echo '<input type="hidden" name="action" value="znk_style"><input type="hidden" name="faces" id="znk-faces" value="' . esc_attr(wp_json_encode($s['faces'])) . '">';
        echo '<table class="form-table" role="presentation">';
        echo '<tr><th>Stile</th><td><label><input type="radio" name="mode" value="site"' . checked($s['mode'], 'site', false) . '> Segui lo stile del sito</label><br>';
        echo '<label><input type="radio" name="mode" value="plugin"' . checked($s['mode'], 'plugin', false) . '> Usa i colori originali di ZNoteKeeper (i campi qui sotto, se compilati, valgono comunque)</label></td></tr>';
        $row = function ($k, $label, $type) use ($s, $d, $src) {
            $det = $d[$k] ?? '';
            echo '<tr><th><label for="znk-' . $k . '">' . esc_html($label) . '</label></th><td>';
            if ($type === 'color') {
                echo '<input type="color" id="znk-' . $k . '-pick" value="' . esc_attr($s[$k] ?: ($det ?: '#ffffff')) . '" style="vertical-align:middle;width:44px;height:30px;padding:0" data-for="znk-' . $k . '"> ';
            }
            echo '<input type="text" class="regular-text" id="znk-' . $k . '" name="' . $k . '" value="' . esc_attr($s[$k]) . '" placeholder="' . esc_attr($det ?: ($type === 'color' ? 'non trovato' : 'carattere di sistema')) . '"' . ($type === 'color' ? ' style="width:120px"' : '') . '>';
            echo ' <button type="button" class="button-link" data-clear="znk-' . $k . '">usa quello del sito</button>';
            echo '<p class="description">Dal sito: ' . ($det !== '' ? '<code>' . esc_html($det) . '</code> (' . esc_html($src[$k] ?? '') . ')' : 'nessun valore trovato, si usa quello di ZNoteKeeper') . '</p></td></tr>';
        };
        $row('accent', 'Colore principale', 'color');
        $row('bg', 'Sfondo', 'color');
        $row('ink', 'Testo', 'color');
        $row('font_body', 'Carattere del testo', 'font');
        $row('font_head', 'Carattere dei titoli', 'font');
        $icon = function_exists('get_site_icon_url') ? get_site_icon_url(64) : '';
        echo '<tr><th>Logo</th><td><label><input type="radio" name="logo" value="icon"' . checked($s['logo'], 'icon', false) . '> Icona del sito' . ($icon ? ' <img src="' . esc_url($icon) . '" alt="" style="width:20px;height:20px;vertical-align:middle;border-radius:4px">' : ' (non impostata: Aspetto › Personalizza › Identità del sito)') . '</label><br>';
        echo '<label><input type="radio" name="logo" value="text"' . checked($s['logo'], 'text', false) . '> Scritta «ZN»</label></td></tr>';
        echo '<tr><th>Rileva dalla home page</th><td><button type="button" class="button" id="znk-detect">Rileva dalla home page</button> <span id="znk-detect-msg" class="description"></span>';
        echo '<p class="description">Utile con temi costruiti con page builder (Elementor, Divi…): apre la home page in modo invisibile, legge colori e caratteri effettivamente mostrati e compila i campi. Poi controlla e salva. I caratteri vengono usati nell\'app solo se i loro file stanno su questo sito (per privacy e sicurezza l\'app non carica risorse da altri siti, per esempio Google Fonts).' . ($s['faces'] ? ' Caratteri del sito salvati: ' . esc_html(implode(', ', array_unique(array_column($s['faces'], 'family')))) . '.' : '') . '</p></td></tr>';
        echo '</table>';
        // anteprima
        echo '<h2>Anteprima</h2><div style="display:flex;gap:16px;flex-wrap:wrap">';
        foreach (['light' => 'Chiaro', 'dark' => 'Scuro'] as $k => $lab) {
            $p = $pv[$k];
            $fb = $pv['r']['font_body'] ? $pv['r']['font_body'] . ',' : '';
            $fh = $pv['r']['font_head'] ? $pv['r']['font_head'] . ',' : $fb;
            echo '<div style="width:280px;border-radius:14px;overflow:hidden;border:1px solid ' . esc_attr($p['line']) . ';background:' . esc_attr($p['surface']) . ';color:' . esc_attr($p['ink']) . ';font-family:' . esc_attr($fb) . 'system-ui,sans-serif">';
            echo '<div style="background:' . esc_attr($p['bg']) . ';padding:8px 12px;font-size:12px;color:' . esc_attr($p['muted']) . '">' . esc_html($lab) . '</div><div style="padding:14px">';
            echo '<div style="font-family:' . esc_attr($fh) . 'system-ui,sans-serif;font-weight:700;font-size:20px;margin-bottom:6px">Le mie note</div>';
            echo '<div style="background:' . esc_attr($p['surface-2']) . ';border-radius:10px;padding:8px 10px;margin-bottom:8px">Riunione di lunedì <span style="color:' . esc_attr($p['muted']) . ';font-size:12px">· ieri</span></div>';
            echo '<div style="background:' . esc_attr($p['accent-soft']) . ';color:' . esc_attr($p['ink']) . ';border-radius:10px;padding:8px 10px;margin-bottom:12px">Pagina selezionata</div>';
            echo '<span style="display:inline-block;background:' . esc_attr($p['accent']) . ';color:' . esc_attr($p['accent-ink']) . ';border-radius:12px;padding:8px 14px;font-weight:700">+ Nuova pagina</span> <a style="color:' . esc_attr($p['accent']) . '">un link</a></div></div>';
        }
        echo '</div><p class="description">L\'anteprima mostra i valori salvati. Ognuno può comunque scegliere chiaro, scuro o automatico nelle impostazioni dell\'app.</p>';
        submit_button('Salva aspetto');
        echo '</form>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('znk_style');
        echo '<input type="hidden" name="action" value="znk_style"><input type="hidden" name="reset" value="1"><button class="button-link" onclick="return confirm(\'Tornare ai valori trovati nel sito?\')">Ripristina i valori del sito</button></form>';
        echo '</div>';
        $home = wp_json_encode(home_url('/'));
        echo <<<JS
<script>
(function(){
  var f = document.getElementById('znk-style-form');
  f.querySelectorAll('[data-for]').forEach(function(p){ p.addEventListener('input', function(){ document.getElementById(p.dataset.for).value = p.value; }); });
  f.querySelectorAll('[data-clear]').forEach(function(b){ b.addEventListener('click', function(){ document.getElementById(b.dataset.clear).value = ''; }); });
  var msg = document.getElementById('znk-detect-msg');
  function rgb(s){ var m = /rgba?\\(([^)]+)\\)/.exec(s || ''); if(!m) return null; var p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat); if(p.length>3 && p[3] < .5) return null; return p.slice(0,3); }
  function hex(c){ return '#' + c.map(function(x){ return ('0' + Math.round(x).toString(16)).slice(-2); }).join('').toUpperCase(); }
  function sat(c){ var mx = Math.max.apply(0,c)/255, mn = Math.min.apply(0,c)/255, l = (mx+mn)/2; return { s: mx===mn ? 0 : (mx-mn)/(1-Math.abs(2*l-1)), l: l }; }
  function colorful(c){ var x = sat(c); return x.s > .18 && x.l > .12 && x.l < .9; }
  function hdTmp(d){ var h = d.querySelector('h1, h2'); return h ? rgb(d.defaultView.getComputedStyle(h).color) : null; }
  function visible(el, w){ var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && w.getComputedStyle(el).visibility !== 'hidden'; }
  document.getElementById('znk-detect').addEventListener('click', function(){
    msg.textContent = 'Apro la home page…';
    var fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0';
    fr.src = {$home};
    var done = false;
    var to = setTimeout(function(){ if(!done){ done = true; msg.textContent = 'La home page non risponde: compila i campi a mano.'; fr.remove(); } }, 20000);
    fr.onload = function(){
      setTimeout(function(){
        if (done) return; done = true; clearTimeout(to);
        try {
          var w = fr.contentWindow, d = fr.contentDocument, cs = function(e){ return w.getComputedStyle(e); };
          // sfondo: risalgo dall'elemento al centro della pagina finché trovo un colore pieno
          var el = d.elementFromPoint(640, 500) || d.body, bg = null;
          for (var e = el; e && !bg; e = e.parentElement) bg = rgb(cs(e).backgroundColor);
          bg = bg || rgb(cs(d.body).backgroundColor) || rgb(cs(d.documentElement).backgroundColor) || [255,255,255];
          var p = d.querySelector('main p, article p, .entry-content p, .elementor-widget-text-editor p, p') || d.body;
          // testo: tra il colore del corpo e quello dei paragrafi, il più leggibile sullo sfondo
          // (molti temi usano per i paragrafi un grigio «secondario»)
          var lum = function(c){ var f = function(v){ v /= 255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); }; return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2]); };
          var con = function(a, b){ var x = lum(a), y = lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
          var ink = [rgb(cs(d.body).color), rgb(cs(p).color), hdTmp(d) ].filter(Boolean).sort(function(a, b){ return con(b, bg) - con(a, bg); })[0] || null;
          var acc = null;
          var cands = d.querySelectorAll('.wp-element-button, .wp-block-button__link, .elementor-button, .et_pb_button, .button, .btn, button[type=submit], input[type=submit], a.button');
          for (var i = 0; i < cands.length && !acc; i++) { if (!visible(cands[i], w)) continue; var c = rgb(cs(cands[i]).backgroundColor); if (c && colorful(c)) acc = c; }
          var links = d.querySelectorAll('main a, article a, .entry-content a, nav a, a');
          for (var j = 0; j < links.length && !acc && j < 200; j++) { if (!visible(links[j], w) || links[j].closest('#wpadminbar')) continue; var c2 = rgb(cs(links[j]).color); if (c2 && colorful(c2)) acc = c2; }
          var hd = d.querySelector('h1, h2, .entry-title, .elementor-heading-title');
          var fb = cs(p).fontFamily, fh = hd ? cs(hd).fontFamily : '';
          // @font-face dei caratteri usati, solo se i file sono su questo sito
          var used = (fb + ',' + fh).toLowerCase(), faces = [], origin = w.location.origin;
          for (var k = 0; k < d.styleSheets.length; k++) {
            var rules; try { rules = d.styleSheets[k].cssRules; } catch (err) { continue; }
            if (!rules) continue;
            for (var n = 0; n < rules.length; n++) {
              var r = rules[n]; if (r.type !== 5) continue;
              var fam = r.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
              if (!fam || used.indexOf(fam.toLowerCase()) < 0) continue;
              var base = d.styleSheets[k].href || d.baseURI, src = [];
              (r.style.getPropertyValue('src').match(/url\\(([^)]+)\\)/g) || []).forEach(function(u){ try { var x = new URL(u.slice(4, -1).replace(/["']/g, ''), base); if (x.origin === origin) src.push(x.href); } catch (e2) {} });
              if (src.length) faces.push({ family: fam, weight: r.style.getPropertyValue('font-weight') || '400', style: r.style.getPropertyValue('font-style') || 'normal', src: src });
            }
          }
          var set = function(id, v){ if (v) { document.getElementById(id).value = v; var pk = document.getElementById(id + '-pick'); if (pk && /^#/.test(v)) pk.value = v.toLowerCase(); } };
          set('znk-bg', hex(bg)); if (ink) set('znk-ink', hex(ink)); if (acc) set('znk-accent', hex(acc));
          set('znk-font_body', fb); set('znk-font_head', fh && fh !== fb ? fh : '');
          document.getElementById('znk-faces').value = JSON.stringify(faces.slice(0, 24));
          f.querySelector('input[name=mode][value=site]').checked = true;
          msg.textContent = 'Fatto: controlla i valori e premi «Salva aspetto».' + (acc ? '' : ' Colore principale non trovato.') + (faces.length ? ' Caratteri del sito: ' + faces.length + ' file.' : '');
        } catch (err) { msg.textContent = 'Non riesco a leggere la home page (' + err.message + '): compila i campi a mano.'; }
        fr.remove();
      }, 1200);
    };
    document.body.appendChild(fr);
  });
})();
</script>
JS;
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

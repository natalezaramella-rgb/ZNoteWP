<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Pagine dell'app: guscio PWA (/znotekeeper/), service worker, manifest,
 * collegamento del dispositivo (/znotekeeper/pair/) e conferma del recupero
 * via email (/znotekeeper/recover/).
 */
class ZNK_App
{
    const ROUTES = ['app', 'sw', 'manifest', 'pair', 'recover'];

    public static function init()
    {
        add_action('init', [__CLASS__, 'add_rewrites']);
        add_filter('query_vars', function ($v) {
            $v[] = 'znk';
            return $v;
        });
        add_action('template_redirect', [__CLASS__, 'dispatch'], 0);
        // Rigenera le regole quando cambia la versione del plugin.
        add_action('init', function () {
            if (get_option('znk_rewrite_version') !== ZNK_VERSION) {
                flush_rewrite_rules(false);
                update_option('znk_rewrite_version', ZNK_VERSION);
            }
        }, 99);
        // Voce "ZNoteKeeper" nella barra di amministrazione per gli utenti abilitati.
        add_action('admin_bar_menu', function ($bar) {
            if (is_user_logged_in() && ZNK_Users::is_enabled(get_current_user_id())) {
                $bar->add_node(['id' => 'znotekeeper', 'title' => 'ZNoteKeeper', 'href' => self::url('')]);
            }
        }, 80);
    }

    public static function add_rewrites()
    {
        add_rewrite_rule('^znotekeeper/?$', 'index.php?znk=app', 'top');
        add_rewrite_rule('^znotekeeper/sw\.js$', 'index.php?znk=sw', 'top');
        add_rewrite_rule('^znotekeeper/manifest\.webmanifest$', 'index.php?znk=manifest', 'top');
        add_rewrite_rule('^znotekeeper/pair/?$', 'index.php?znk=pair', 'top');
        add_rewrite_rule('^znotekeeper/recover/?$', 'index.php?znk=recover', 'top');
    }

    public static function pretty()
    {
        return (bool) get_option('permalink_structure');
    }

    /** URL di una pagina dell'app ('' = app, 'pair/', 'recover/', 'sw.js', 'manifest.webmanifest'). */
    public static function url($path)
    {
        if (self::pretty()) {
            return home_url('/znotekeeper/' . $path);
        }
        $map = ['' => 'app', 'pair/' => 'pair', 'recover/' => 'recover', 'sw.js' => 'sw', 'manifest.webmanifest' => 'manifest'];
        return add_query_arg('znk', isset($map[$path]) ? $map[$path] : 'app', home_url('/'));
    }

    public static function dispatch()
    {
        $r = get_query_var('znk');
        if (!$r || !in_array($r, self::ROUTES, true)) {
            return;
        }
        call_user_func([__CLASS__, 'route_' . $r]);
        exit;
    }

    private static function security_headers()
    {
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('X-Frame-Options: DENY');
        header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
        header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    }

    public static function asset($rel)
    {
        return ZNK_URL . 'app/' . $rel . '?v=' . ZNK_VERSION;
    }

    public static function assets()
    {
        return [
            'app.css',
            'vendor/marked.umd.js',
            'vendor/purify.min.js',
            'vendor/turndown.browser.umd.js',
            'vendor/turndown-plugin-gfm.js',
            'js/main.js', 'js/db.js', 'js/crypto.js', 'js/api.js', 'js/store.js', 'js/ui.js', 'js/md.js',
            'js/editor.js', 'js/draw.js', 'js/notes.js', 'js/tasks.js', 'js/search.js', 'js/settings.js',
            'js/lock.js', 'js/zip.js', 'js/datepicker.js', 'js/icons.js', 'js/mailin.js', 'js/transfer.js', 'js/ctx.js',
            'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
        ];
    }

    private static function config()
    {
        return [
            'version' => ZNK_VERSION,
            'rest' => esc_url_raw(rest_url('znk/v1/')),
            'app' => self::url(''),
            'pair' => self::url('pair/'),
            'sw' => self::url('sw.js'),
            'assets' => ZNK_URL . 'app/',
            'site' => wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES),
            'home' => home_url('/'),
        ];
    }

    private static function head($title, $extra = '')
    {
        $theme = '#136F5E';
        echo '<!doctype html><html lang="it"><head><meta charset="utf-8">';
        echo '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">';
        echo '<title>' . esc_html($title) . '</title>';
        echo '<meta name="theme-color" content="' . $theme . '">';
        echo '<meta name="robots" content="noindex,nofollow">';
        echo '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">';
        echo '<meta name="apple-mobile-web-app-title" content="ZNote"><meta name="apple-mobile-web-app-status-bar-style" content="default">';
        echo '<link rel="manifest" href="' . esc_url(self::url('manifest.webmanifest')) . '">';
        echo '<link rel="icon" href="' . esc_url(self::asset('icons/icon-192.png')) . '">';
        echo '<link rel="apple-touch-icon" href="' . esc_url(self::asset('icons/icon-192.png')) . '">';
        echo '<link rel="stylesheet" href="' . esc_url(self::asset('app.css')) . '">';
        echo $extra;
        echo '<script type="application/json" id="znk-config">' . wp_json_encode(self::config(), JSON_HEX_TAG | JSON_HEX_AMP) . '</script>';
        echo '</head>';
    }

    public static function route_app()
    {
        nocache_headers();
        self::security_headers();
        header('Content-Type: text/html; charset=utf-8');
        self::head('ZNoteKeeper');
        echo '<body><div id="app" class="app"><div class="boot"><div class="logo">ZN</div><p>Caricamento…</p></div></div>';
        foreach (['vendor/marked.umd.js', 'vendor/purify.min.js', 'vendor/turndown.browser.umd.js', 'vendor/turndown-plugin-gfm.js'] as $v) {
            echo '<script src="' . esc_url(self::asset($v)) . '"></script>';
        }
        echo '<script type="module" src="' . esc_url(self::asset('js/main.js')) . '"></script>';
        echo '</body></html>';
    }

    public static function route_manifest()
    {
        header('Content-Type: application/manifest+json; charset=utf-8');
        header('Cache-Control: public, max-age=3600');
        $start = self::url('');
        echo wp_json_encode([
            'name' => 'ZNoteKeeper',
            'short_name' => 'ZNote',
            'description' => 'Taccuino e attività riservati',
            'id' => $start,
            'start_url' => $start,
            'scope' => self::pretty() ? home_url('/znotekeeper/') : home_url('/'),
            'display' => 'standalone',
            'display_override' => ['window-controls-overlay', 'standalone'],
            'orientation' => 'any',
            'background_color' => '#FBFCFB',
            'theme_color' => '#136F5E',
            'lang' => 'it',
            'icons' => [
                ['src' => self::asset('icons/icon-192.png'), 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => self::asset('icons/icon-512.png'), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => self::asset('icons/maskable-512.png'), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
            ],
            'shortcuts' => [
                ['name' => 'Nuova pagina', 'url' => add_query_arg('do', 'new-page', $start)],
                ['name' => 'Nuova attività', 'url' => add_query_arg('do', 'new-task', $start)],
                ['name' => 'Cerca', 'url' => add_query_arg('do', 'search', $start)],
            ],
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    public static function route_sw()
    {
        header('Content-Type: application/javascript; charset=utf-8');
        header('Cache-Control: no-cache');
        header('Service-Worker-Allowed: ' . (self::pretty() ? wp_parse_url(home_url('/znotekeeper/'), PHP_URL_PATH) : '/'));
        $assets = array_map([__CLASS__, 'asset'], self::assets());
        $cfg = [
            'version' => ZNK_VERSION,
            'shell' => self::url(''),
            'assets' => $assets,
            'icon' => self::asset('icons/icon-192.png'),
        ];
        echo 'const ZNK = ' . wp_json_encode($cfg, JSON_UNESCAPED_SLASHES) . ";\n";
        readfile(ZNK_DIR . 'app/sw-body.js');
    }

    public static function route_pair()
    {
        nocache_headers();
        if (!is_user_logged_in()) {
            auth_redirect();
            exit;
        }
        self::security_headers();
        header('Content-Type: text/html; charset=utf-8');
        $uid = get_current_user_id();
        $u = wp_get_current_user();
        $enabled = ZNK_Users::is_enabled($uid);
        self::head('Collega dispositivo · ZNoteKeeper', '<script type="application/json" id="znk-pair">' . wp_json_encode([
            'nonce' => wp_create_nonce('wp_rest'),
            'enabled' => $enabled,
            'name' => $u->display_name,
        ], JSON_HEX_TAG | JSON_HEX_AMP) . '</script>');
        echo '<body><div class="app"><section class="screen lock"><div class="logo">ZN</div>';
        if ($enabled) {
            echo '<h2>Collego questo dispositivo</h2><p id="msg">Un attimo…</p>';
        } else {
            echo '<h2>Accesso non abilitato</h2><p>Il tuo utente <b>' . esc_html($u->user_login) . '</b> non è abilitato a ZNoteKeeper. Chiedi all\'amministratore del sito di abilitarlo da Utenti › ZNoteKeeper.</p>';
            echo '<a class="btn ghost" href="' . esc_url(home_url('/')) . '">Torna al sito</a>';
        }
        echo '</section></div><script type="module" src="' . esc_url(self::asset('js/pair.js')) . '"></script></body></html>';
    }

    public static function route_recover()
    {
        nocache_headers();
        if (!is_user_logged_in()) {
            auth_redirect();
            exit;
        }
        self::security_headers();
        header('Content-Type: text/html; charset=utf-8');
        self::head('Recupero accesso · ZNoteKeeper', '<script type="application/json" id="znk-pair">' . wp_json_encode([
            'nonce' => wp_create_nonce('wp_rest'),
            'mode' => 'recover',
        ], JSON_HEX_TAG | JSON_HEX_AMP) . '</script>');
        echo '<body><div class="app"><section class="screen lock"><div class="logo">ZN</div><h2>Recupero dell\'accesso</h2><p id="msg">Verifico il link…</p>';
        echo '<a class="btn ghost" id="go" href="' . esc_url(self::url('')) . '" hidden>Apri ZNoteKeeper</a>';
        echo '</section></div><script type="module" src="' . esc_url(self::asset('js/pair.js')) . '"></script></body></html>';
    }
}

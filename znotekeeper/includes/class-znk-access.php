<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Accessi per i clienti: invio via email di indirizzo e nome utente con un
 * link monouso, a scadenza, per leggere la password iniziale.
 *
 * Come resta riservata la password:
 * - nel taccuino l'accesso è un elemento cifrato come gli altri (kind "access");
 * - per ogni invio il browser genera una chiave casuale K (AES-256-GCM) e cifra
 *   con K i dati da mostrare al cliente. Al sito arriva solo il testo cifrato;
 * - K sta solo nel frammento "#" del link, che i browser non mandano mai al
 *   server. Il sito la vede solo per un istante mentre spedisce l'email e non
 *   la salva da nessuna parte: nel database restano l'impronta SHA-256 del
 *   token, il testo cifrato e la scadenza;
 * - aprire il link non consuma nulla (i filtri antispam che visitano i link non
 *   lo bruciano): il token si usa solo quando il cliente preme "Mostra", con
 *   una richiesta POST. In quel momento il sito consegna il cifrato e lo
 *   cancella; dopo la scadenza il cifrato viene cancellato comunque.
 */
class ZNK_Access
{
    const DB_VERSION = '1';
    const LINK_MARK = '[[ZNK_LINK]]';
    const MAX_HOURS = 720;
    const MAX_PER_HOUR = 30;

    public static function t()
    {
        return ZNK_DB::t('access');
    }

    public static function init()
    {
        if (get_option('znk_access_db') !== self::DB_VERSION) {
            self::install();
        }
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_action('init', [__CLASS__, 'add_rewrites']);
        add_action('template_redirect', [__CLASS__, 'dispatch'], 0);
        add_action('znk_daily', [__CLASS__, 'cleanup']);
    }

    public static function install()
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $t = self::t();
        dbDelta("CREATE TABLE $t (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  item_id VARCHAR(40) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  key_check CHAR(64) NOT NULL,
  payload TEXT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  viewed_at DATETIME NULL,
  revoked_at DATETIME NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY token_hash (token_hash),
  KEY user_item (user_id,item_id)
) " . $wpdb->get_charset_collate() . ';');
        update_option('znk_access_db', self::DB_VERSION);
    }

    public static function drop()
    {
        global $wpdb;
        $wpdb->query('DROP TABLE IF EXISTS ' . self::t());
        delete_option('znk_access_db');
    }

    public static function delete_user($user_id)
    {
        global $wpdb;
        $wpdb->delete(self::t(), ['user_id' => (int) $user_id]);
    }

    // ===================== Pagina pubblica =====================

    public static function add_rewrites()
    {
        add_rewrite_rule('^znotekeeper/access/?$', 'index.php?znk=access', 'top');
    }

    public static function page_url($token)
    {
        $base = ZNK_App::pretty() ? home_url('/znotekeeper/access/') : add_query_arg('znk', 'access', home_url('/'));
        return add_query_arg('t', $token, $base);
    }

    public static function dispatch()
    {
        if (get_query_var('znk') !== 'access') {
            return;
        }
        nocache_headers();
        header('Content-Type: text/html; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        header('X-Frame-Options: DENY');
        header('X-Robots-Tag: noindex, nofollow');
        header("Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        $site = wp_specialchars_decode(get_bloginfo('name'), ENT_QUOTES);
        $cfg = ['rest' => esc_url_raw(rest_url('znk/v1/')), 'site' => $site];
        $v = '?v=' . ZNK_VERSION;
        echo '<!doctype html><html lang="it"><head><meta charset="utf-8">';
        echo '<meta name="viewport" content="width=device-width,initial-scale=1">';
        echo '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">';
        echo '<title>Dati di accesso · ' . esc_html($site) . '</title>';
        echo '<link rel="stylesheet" href="' . esc_url(ZNK_URL . 'app/access.css' . $v) . '">';
        echo '<script type="application/json" id="znk-access">' . wp_json_encode($cfg, JSON_HEX_TAG | JSON_HEX_AMP) . '</script>';
        echo '</head><body><main class="card" id="box">';
        echo '<div class="site">' . esc_html($site) . '</div>';
        echo '<h1>Dati di accesso</h1><p id="msg">Un attimo…</p><noscript><p>Per vedere la password serve JavaScript attivo.</p></noscript>';
        echo '</main><script src="' . esc_url(ZNK_URL . 'app/access-view.js' . $v) . '"></script></body></html>';
        exit;
    }

    // ===================== API =====================

    public static function routes()
    {
        $ns = ZNK_REST::NS;
        $c = __CLASS__;
        $pub = function () {
            return true;
        };
        register_rest_route($ns, '/access/check', ['methods' => 'POST', 'callback' => [$c, 'check'], 'permission_callback' => $pub]);
        register_rest_route($ns, '/access/reveal', ['methods' => 'POST', 'callback' => [$c, 'reveal'], 'permission_callback' => $pub]);
        foreach (['send' => 'POST', 'revoke' => 'POST', 'status' => 'GET'] as $r => $m) {
            register_rest_route($ns, '/access/' . $r, [
                'methods' => $m,
                'permission_callback' => $pub, // il controllo vero è la sessione dell'app sbloccata
                'callback' => function ($req) use ($c, $r) {
                    $ctx = ZNK_Auth::session_from_request($req);
                    if (is_wp_error($ctx)) {
                        return $ctx;
                    }
                    return call_user_func([$c, $r], $req, (int) $ctx['user']->user_id);
                },
            ]);
        }
    }

    private static function err($code, $msg, $status = 400)
    {
        return new WP_Error($code, $msg, ['status' => $status]);
    }

    private static function p($req, $k, $max)
    {
        $p = $req->get_json_params();
        $v = is_array($p) && isset($p[$k]) ? $p[$k] : '';
        return is_string($v) && strlen($v) <= $max ? $v : '';
    }

    private static function valid_item_id($id)
    {
        return is_string($id) && preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id);
    }

    private static function state($r)
    {
        if ($r->revoked_at) {
            return 'revoked';
        }
        if ($r->viewed_at) {
            return 'viewed';
        }
        if (strtotime($r->expires_at . ' UTC') <= time()) {
            return 'expired';
        }
        return 'active';
    }

    private static function out($r)
    {
        return [
            'id' => (int) $r->id,
            'item_id' => $r->item_id,
            'state' => self::state($r),
            'created_at' => $r->created_at . 'Z',
            'expires_at' => $r->expires_at . 'Z',
            'viewed_at' => $r->viewed_at ? $r->viewed_at . 'Z' : null,
            'revoked_at' => $r->revoked_at ? $r->revoked_at . 'Z' : null,
        ];
    }

    /** Elenco degli invii dell'utente (stato dei link), senza dati riservati. */
    public static function status($req, $uid)
    {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare('SELECT id, item_id, created_at, expires_at, viewed_at, revoked_at FROM ' . self::t() . ' WHERE user_id = %d ORDER BY id DESC LIMIT 2000', $uid));
        return ['links' => array_map([__CLASS__, 'out'], $rows)];
    }

    private static function revoke_item($uid, $item_id)
    {
        global $wpdb;
        return $wpdb->query($wpdb->prepare('UPDATE ' . self::t() . ' SET revoked_at = %s, payload = NULL WHERE user_id = %d AND item_id = %s AND revoked_at IS NULL AND viewed_at IS NULL', ZNK_DB::now(), $uid, $item_id));
    }

    public static function revoke($req, $uid)
    {
        $item = self::p($req, 'item_id', 40);
        if (!self::valid_item_id($item)) {
            return self::err('znk_bad', 'Accesso non valido.');
        }
        return ['revoked' => (int) self::revoke_item($uid, $item)];
    }

    private static function clean_line($s, $max)
    {
        $s = preg_replace('/[\r\n\t]+/', ' ', (string) $s);
        return trim(mb_substr(wp_strip_all_tags($s), 0, $max));
    }

    public static function send($req, $uid)
    {
        global $wpdb;
        $item = self::p($req, 'item_id', 40);
        $to = trim(self::p($req, 'to', 190));
        $subject = self::clean_line(self::p($req, 'subject', 400), 250);
        $body = str_replace("\r\n", "\n", self::p($req, 'body', 20000));
        $from_name = self::clean_line(self::p($req, 'from_name', 200), 120);
        $from_email = trim(self::p($req, 'from_email', 190));
        $key = self::p($req, 'key', 100);
        $key_check = self::p($req, 'key_check', 64);
        $payload = self::p($req, 'payload', 20000);
        $hours = (int) (is_array($req->get_json_params()) ? ($req->get_json_params()['hours'] ?? 0) : 0);

        if (!self::valid_item_id($item)) {
            return self::err('znk_bad', 'Accesso non valido.');
        }
        if (!is_email($to)) {
            return self::err('znk_bad_email', 'L\'indirizzo email del cliente non è valido.');
        }
        if ($subject === '' || trim($body) === '' || substr_count($body, self::LINK_MARK) < 1) {
            return self::err('znk_bad', 'L\'email deve avere un oggetto e contenere il link ({link}).');
        }
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $key) || !preg_match('/^[a-f0-9]{64}$/', $key_check)) {
            return self::err('znk_bad', 'Chiave del link non valida.');
        }
        $box = json_decode($payload, true);
        if (!is_array($box) || empty($box['iv']) || empty($box['ct']) || !is_string($box['iv']) || !is_string($box['ct'])) {
            return self::err('znk_bad', 'Dati cifrati non validi.');
        }
        if ($from_email !== '' && !self::allowed_from($from_email)) {
            return self::err('znk_bad_from', 'L\'indirizzo mittente deve essere del dominio ' . self::site_domain() . ', altrimenti l\'email finisce nello spam.');
        }
        if ($hours < 1 || $hours > self::MAX_HOURS) {
            return self::err('znk_bad', 'La validità del link va da 1 a ' . self::MAX_HOURS . ' ore.');
        }
        // Limite di invii per non trasformare il sito in un invio massivo di email.
        $rk = 'znk_access_rate_' . $uid;
        $n = (int) get_transient($rk);
        if ($n >= self::MAX_PER_HOUR) {
            return self::err('znk_wait', 'Hai inviato troppi accessi nell\'ultima ora. Riprova più tardi.', 429);
        }

        $token = ZNK_Secret::token(32);
        $now = time();
        $link = self::page_url($token) . '#' . $key;
        $ok_insert = $wpdb->insert(self::t(), [
            'user_id' => $uid,
            'item_id' => $item,
            'token_hash' => ZNK_Secret::hash($token),
            'key_check' => $key_check,
            'payload' => wp_json_encode(['iv' => $box['iv'], 'ct' => $box['ct']]),
            'created_at' => gmdate('Y-m-d H:i:s', $now),
            'expires_at' => gmdate('Y-m-d H:i:s', $now + $hours * HOUR_IN_SECONDS),
        ]);
        if (!$ok_insert) {
            return self::err('znk_db', 'Non riesco a salvare il link. Riprova.', 500);
        }
        $id = (int) $wpdb->insert_id;

        $wp = get_userdata($uid);
        $headers = ['Content-Type: text/plain; charset=UTF-8'];
        if ($wp && is_email($wp->user_email)) {
            $headers[] = 'Reply-To: ' . ($from_name !== '' ? '"' . str_replace('"', '', $from_name) . '" ' : '') . '<' . $wp->user_email . '>';
        }
        $name_filter = function ($n) use ($from_name) {
            return $from_name !== '' ? $from_name : $n;
        };
        $from_filter = function ($e) use ($from_email) {
            return $from_email !== '' ? $from_email : $e;
        };
        add_filter('wp_mail_from_name', $name_filter, 999);
        add_filter('wp_mail_from', $from_filter, 999);
        $sent = wp_mail($to, $subject, str_replace(self::LINK_MARK, $link, $body), $headers);
        remove_filter('wp_mail_from_name', $name_filter, 999);
        remove_filter('wp_mail_from', $from_filter, 999);
        unset($link, $key);

        if (!$sent) {
            $wpdb->delete(self::t(), ['id' => $id]);
            return self::err('znk_mail_fail', 'Il sito non è riuscito a spedire l\'email. Controlla la configurazione email di WordPress.', 502);
        }
        set_transient($rk, $n + 1, HOUR_IN_SECONDS);
        // Un solo link valido per accesso: quelli precedenti non funzionano più.
        $wpdb->query($wpdb->prepare('UPDATE ' . self::t() . ' SET revoked_at = %s, payload = NULL WHERE user_id = %d AND item_id = %s AND id <> %d AND revoked_at IS NULL AND viewed_at IS NULL', ZNK_DB::now(), $uid, $item, $id));
        $row = $wpdb->get_row($wpdb->prepare('SELECT id, item_id, created_at, expires_at, viewed_at, revoked_at FROM ' . self::t() . ' WHERE id = %d', $id));
        return ['link' => self::out($row)];
    }

    /** Dominio del sito senza "www." (es. zaramella.com). */
    public static function site_domain()
    {
        $h = strtolower((string) wp_parse_url(home_url('/'), PHP_URL_HOST));
        return preg_replace('/^www\./', '', $h);
    }

    /** Il mittente può essere solo un indirizzo del dominio del sito (o di un suo sottodominio). */
    private static function allowed_from($email)
    {
        if (!is_email($email)) {
            return false;
        }
        $dom = strtolower(substr(strrchr($email, '@'), 1));
        $site = self::site_domain();
        return $site !== '' && ($dom === $site || substr($dom, -strlen('.' . $site)) === '.' . $site);
    }

    // ----- pagina pubblica -----

    private static function row_from_token($req)
    {
        global $wpdb;
        $t = self::p($req, 't', 100);
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $t)) {
            return null;
        }
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t() . ' WHERE token_hash = %s', ZNK_Secret::hash($t)));
    }

    private static function public_state($r)
    {
        if (!$r) {
            return ['state' => 'invalid'];
        }
        $s = self::state($r);
        $out = ['state' => $s];
        if ($s === 'active') {
            $out['expires_at'] = $r->expires_at . 'Z';
        }
        if ($s === 'viewed') {
            $out['viewed_at'] = $r->viewed_at . 'Z';
        }
        return $out;
    }

    /** Stato del link, senza consumarlo. */
    public static function check($req)
    {
        return self::public_state(self::row_from_token($req));
    }

    /** Consegna il cifrato una sola volta e lo cancella. */
    public static function reveal($req)
    {
        global $wpdb;
        $r = self::row_from_token($req);
        $st = self::public_state($r);
        if ($st['state'] !== 'active' || !$r->payload) {
            return new WP_REST_Response($st + ['code' => 'znk_gone'], 410);
        }
        $kc = self::p($req, 'key_check', 64);
        if (!preg_match('/^[a-f0-9]{64}$/', $kc) || !hash_equals($r->key_check, $kc)) {
            return self::err('znk_bad_key', 'Il link è incompleto: copialo per intero dall\'email e riprova.');
        }
        // Consumo atomico: se due richieste arrivano insieme, solo una ottiene i dati.
        $done = $wpdb->query($wpdb->prepare('UPDATE ' . self::t() . ' SET viewed_at = %s, payload = NULL WHERE id = %d AND viewed_at IS NULL AND revoked_at IS NULL AND payload IS NOT NULL', ZNK_DB::now(), $r->id));
        if ($done !== 1) {
            return new WP_REST_Response(['state' => 'viewed', 'code' => 'znk_gone'], 410);
        }
        $res = new WP_REST_Response(['payload' => json_decode($r->payload, true)]);
        $res->header('Cache-Control', 'no-store, private');
        return $res;
    }

    /** Ogni giorno: cancella i cifrati scaduti e le tracce vecchie. */
    public static function cleanup()
    {
        global $wpdb;
        $t = self::t();
        $wpdb->query($wpdb->prepare("UPDATE $t SET payload = NULL WHERE payload IS NOT NULL AND expires_at < %s", ZNK_DB::now()));
        $wpdb->query($wpdb->prepare("DELETE FROM $t WHERE created_at < %s", gmdate('Y-m-d H:i:s', time() - 365 * DAY_IN_SECONDS)));
        // Link di accessi eliminati dal taccuino.
        $it = ZNK_DB::t('items');
        $wpdb->query("DELETE a FROM $t a LEFT JOIN $it i ON i.user_id = a.user_id AND i.id = a.item_id WHERE i.id IS NULL OR i.purged = 1");
    }
}

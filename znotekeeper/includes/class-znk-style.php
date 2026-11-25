<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Aspetto dell'app: colori e caratteri presi dal tema del sito in cui il plugin
 * è installato, così ZNoteKeeper sembra parte del sito.
 *
 * Da dove vengono i valori, in ordine:
 *  1. scelte dell'amministratore (Utenti › ZNoteKeeper › Aspetto), anche solo per un campo;
 *  2. stili globali del tema (theme.json / Editor del sito) per i temi a blocchi;
 *  3. tavolozza dei colori dichiarata dal tema e personalizzazioni dei temi classici
 *     più diffusi (Astra, GeneratePress, Kadence, OceanWP, sfondo del Personalizza);
 *  4. i colori originali di ZNoteKeeper.
 *
 * Dai tre colori di base (sfondo, testo, colore principale) si ricava tutta la
 * tavolozza dell'app, chiara e scura, con un contrasto leggibile garantito.
 * Il CSS prodotto è inserito nella pagina dell'app (quindi rientra nell'impronta
 * del guscio controllata dal service worker) e contiene solo valori ricostruiti
 * e validati: niente testo libero dell'amministratore finisce nel CSS così com'è.
 */
class ZNK_Style
{
    const OPT = 'znk_style';
    const DEFAULT_ACCENT = '#136F5E';
    const FALLBACK_BODY = '"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",sans-serif';
    const FALLBACK_HEAD = '"Bricolage Grotesque","Avenir Next","Segoe UI Variable Display","Segoe UI",system-ui,sans-serif';

    private static $cache = null;

    public static function settings()
    {
        $s = get_option(self::OPT, []);
        $s = is_array($s) ? $s : [];
        return array_merge([
            'mode' => 'site',      // site = segue il tema; plugin = colori originali di ZNoteKeeper
            'accent' => '',        // vuoti = presi dal sito
            'bg' => '',
            'ink' => '',
            'font_body' => '',
            'font_head' => '',
            'logo' => 'icon',      // icon = icona del sito (se c'è) al posto di «ZN»; text = «ZN»
            'faces' => [],         // @font-face rilevati dalla home page (solo file dello stesso sito)
        ], $s);
    }

    public static function save($in)
    {
        $s = self::settings();
        $s['mode'] = in_array($in['mode'] ?? '', ['site', 'plugin'], true) ? $in['mode'] : 'site';
        foreach (['accent', 'bg', 'ink'] as $k) {
            $c = self::parse_color((string) ($in[$k] ?? ''));
            $s[$k] = $c ? self::hex($c) : '';
        }
        foreach (['font_body', 'font_head'] as $k) {
            $s[$k] = self::clean_family((string) ($in[$k] ?? ''));
        }
        $s['logo'] = ($in['logo'] ?? '') === 'text' ? 'text' : 'icon';
        if (isset($in['faces'])) {
            $faces = is_string($in['faces']) ? json_decode($in['faces'], true) : $in['faces'];
            $s['faces'] = self::clean_faces(is_array($faces) ? $faces : []);
        }
        update_option(self::OPT, $s, true);
        self::$cache = null;
    }

    // ===================== rilevamento dal tema =====================

    /** Valori trovati nel tema attivo, con l'origine di ciascuno. */
    public static function detect()
    {
        $out = ['accent' => '', 'bg' => '', 'ink' => '', 'font_body' => '', 'font_head' => '', 'src' => []];
        $set = function ($k, $v, $src) use (&$out) {
            if ($out[$k] !== '' || $v === '' || $v === null) {
                return;
            }
            if (in_array($k, ['accent', 'bg', 'ink'], true)) {
                $c = self::parse_color((string) $v);
                if (!$c) {
                    return;
                }
                $v = self::hex($c);
            } else {
                $v = self::clean_family((string) $v);
                if ($v === '' || preg_match('/^(inherit|initial|default|unset)$/i', $v)) {
                    return;
                }
            }
            $out[$k] = $v;
            $out['src'][$k] = $src;
        };

        $has_json = function_exists('wp_theme_has_theme_json') ? wp_theme_has_theme_json() : (class_exists('WP_Theme_JSON_Resolver') && WP_Theme_JSON_Resolver::theme_has_support());
        $palette = self::theme_palette();
        $families = self::theme_families();

        // 1) stili globali del tema a blocchi (comprese le modifiche fatte nell'Editor del sito)
        if ($has_json && function_exists('wp_get_global_styles')) {
            $st = wp_get_global_styles();
            $r = function ($v) use ($palette, $families) {
                return self::resolve_preset($v, $palette, $families);
            };
            $set('bg', $r($st['color']['background'] ?? ''), 'theme.json');
            $set('ink', $r($st['color']['text'] ?? ''), 'theme.json');
            // il colore dei pulsanti è il più «di marca»; va bene anche nero o grigio scuro
            // (temi monocromatici), purché si distingua dallo sfondo
            $btn = self::parse_color($r($st['elements']['button']['color']['background'] ?? ''));
            $bgc = self::parse_color($r($st['color']['background'] ?? '')) ?: [255, 255, 255];
            if ($btn && (self::colorful($btn) || self::contrast($btn, $bgc) >= 3)) {
                $set('accent', self::hex($btn), 'theme.json (pulsanti)');
            }
            $link = $r($st['elements']['link']['color']['text'] ?? '');
            if ($link && self::colorful($link)) {
                $set('accent', $link, 'theme.json (link)');
            }
            $set('font_body', $r($st['typography']['fontFamily'] ?? ''), 'theme.json');
            $set('font_head', $r($st['elements']['heading']['typography']['fontFamily'] ?? ($st['elements']['h1']['typography']['fontFamily'] ?? '')), 'theme.json');
        }

        // 2) temi classici diffusi
        $astra = get_option('astra-settings');
        if (is_array($astra)) {
            $p = $astra['global-color-palette']['palette'] ?? [];
            $set('accent', $p[0] ?? '', 'Astra');
            $set('ink', $p[3] ?? '', 'Astra');
            $set('bg', $p[4] ?? '', 'Astra');
            $set('font_body', $astra['body-font-family'] ?? '', 'Astra');
            $set('font_head', $astra['headings-font-family'] ?? '', 'Astra');
        }
        $gp = get_option('generate_settings');
        if (is_array($gp)) {
            $gc = [];
            foreach ((array) ($gp['global_colors'] ?? []) as $g) {
                if (isset($g['slug'], $g['color'])) {
                    $gc[$g['slug']] = $g['color'];
                }
            }
            $set('accent', $gc['accent'] ?? ($gp['link_color'] ?? ''), 'GeneratePress');
            $set('ink', $gc['contrast'] ?? ($gp['text_color'] ?? ''), 'GeneratePress');
            $set('bg', $gc['base-3'] ?? ($gp['background_color'] ?? ''), 'GeneratePress');
        }
        $kad = get_option('kadence_global_palette');
        if (is_string($kad) && $kad !== '') {
            $k = json_decode($kad, true);
            $act = is_array($k) ? ($k['active'] ?? 'palette') : '';
            $kp = is_array($k) && isset($k[$act]) && is_array($k[$act]) ? $k[$act] : [];
            $set('accent', $kp[0]['color'] ?? '', 'Kadence');
            $set('ink', $kp[3]['color'] ?? '', 'Kadence');
            $set('bg', $kp[8]['color'] ?? '', 'Kadence');
        }
        $mods = get_theme_mods();
        if (is_array($mods)) {
            // OceanWP e molti altri: ocean_primary_color, primary_color, accent_color, link_color…
            foreach ($mods as $key => $val) {
                if (is_string($val) && preg_match('/(^|_)(primary|accent|brand|theme|link)_?colou?r$/', (string) $key)) {
                    $set('accent', $val, 'Personalizza (' . $key . ')');
                }
            }
            foreach ($mods as $key => $val) {
                if (is_string($val) && preg_match('/(^|_)(body_)?(text|font)_colou?r$/', (string) $key)) {
                    $set('ink', $val, 'Personalizza (' . $key . ')');
                }
            }
            if (!empty($mods['background_color'])) {
                $set('bg', '#' . ltrim((string) $mods['background_color'], '#'), 'Personalizza (sfondo)');
            }
        }

        // 3) tavolozza dichiarata dal tema (anche i temi classici la dichiarano per l'editor)
        $pick = function ($slugs) use ($palette) {
            foreach ($slugs as $s) {
                if (isset($palette[$s])) {
                    return $palette[$s];
                }
            }
            return '';
        };
        $acc = $pick(['primary', 'accent', 'brand', 'accent-1', 'theme', 'secondary', 'tertiary', 'vivid-cyan-blue']);
        if ($acc && self::colorful($acc)) {
            $set('accent', $acc, 'tavolozza del tema');
        }
        $set('bg', $pick(['base', 'background', 'base-2', 'white']), 'tavolozza del tema');
        $set('ink', $pick(['contrast', 'foreground', 'text', 'main', 'black']), 'tavolozza del tema');
        if ($out['accent'] === '') {
            foreach ($palette as $c) {
                if (self::colorful($c)) {
                    $set('accent', $c, 'tavolozza del tema');
                    break;
                }
            }
        }
        if ($out['font_body'] === '' && $families) {
            $set('font_body', $families['body'] ?? ($families['primary'] ?? ($families['system-font'] ?? reset($families))), 'caratteri del tema');
        }
        if ($out['font_head'] === '' && $families) {
            $set('font_head', $families['heading'] ?? ($families['secondary'] ?? ''), 'caratteri del tema');
        }
        return $out;
    }

    /** slug => colore della tavolozza del tema (e dell'utente), senza la tavolozza predefinita di WordPress. */
    private static function theme_palette()
    {
        $out = [];
        if (!function_exists('wp_get_global_settings')) {
            return $out;
        }
        $p = wp_get_global_settings(['color', 'palette']);
        if (!is_array($p)) {
            return $out;
        }
        $lists = isset($p['theme']) || isset($p['custom']) || isset($p['default']) ? array_merge((array) ($p['theme'] ?? []), (array) ($p['custom'] ?? [])) : $p;
        foreach ($lists as $e) {
            if (is_array($e) && isset($e['slug'], $e['color']) && is_string($e['color'])) {
                $out[(string) $e['slug']] = $e['color'];
            }
        }
        return $out;
    }

    /** slug => font-family dichiarati dal tema. */
    private static function theme_families()
    {
        $out = [];
        if (!function_exists('wp_get_global_settings')) {
            return $out;
        }
        $f = wp_get_global_settings(['typography', 'fontFamilies']);
        if (!is_array($f)) {
            return $out;
        }
        $lists = isset($f['theme']) || isset($f['custom']) || isset($f['default']) ? array_merge((array) ($f['theme'] ?? []), (array) ($f['custom'] ?? [])) : $f;
        foreach ($lists as $e) {
            if (is_array($e) && isset($e['slug'], $e['fontFamily']) && is_string($e['fontFamily'])) {
                $out[(string) $e['slug']] = $e['fontFamily'];
            }
        }
        return $out;
    }

    /** Traduce var:preset|color|x e var(--wp--preset--color--x) nel valore della tavolozza. */
    private static function resolve_preset($v, $palette, $families)
    {
        if (!is_string($v) || $v === '') {
            return '';
        }
        if (preg_match('/^var:preset\|(color|font-family)\|([\w-]+)$/', $v, $m) || preg_match('/var\(\s*--wp--preset--(color|font-family)--([\w-]+)/', $v, $m)) {
            $map = $m[1] === 'color' ? $palette : $families;
            return $map[$m[2]] ?? '';
        }
        return $v;
    }

    /** @font-face dei caratteri del tema (theme.json, WordPress 6.4+), solo file di questo sito. */
    private static function theme_faces()
    {
        if (!class_exists('WP_Font_Face_Resolver') || !method_exists('WP_Font_Face_Resolver', 'get_fonts_from_theme_json')) {
            return [];
        }
        $faces = [];
        foreach ((array) WP_Font_Face_Resolver::get_fonts_from_theme_json() as $family) {
            foreach ((array) $family as $f) {
                if (!is_array($f) || empty($f['font-family']) || empty($f['src'])) {
                    continue;
                }
                $faces[] = [
                    'family' => $f['font-family'],
                    'weight' => $f['font-weight'] ?? '400',
                    'style' => $f['font-style'] ?? 'normal',
                    'stretch' => $f['font-stretch'] ?? '',
                    'src' => array_values((array) $f['src']),
                ];
            }
        }
        return self::clean_faces($faces);
    }

    // ===================== valori finali e CSS =====================

    /** Colori e caratteri effettivi (scelte dell'admin > tema > originali). */
    public static function resolved()
    {
        if (self::$cache !== null && self::$cache['theme'] === get_stylesheet()) {
            return self::$cache;
        }
        $s = self::settings();
        $d = $s['mode'] === 'plugin' ? ['accent' => '', 'bg' => '', 'ink' => '', 'font_body' => '', 'font_head' => '', 'src' => []] : self::detect();
        $r = [];
        foreach (['accent', 'bg', 'ink', 'font_body', 'font_head'] as $k) {
            $r[$k] = $s[$k] !== '' ? $s[$k] : $d[$k];
        }
        $r['custom'] = $s['mode'] !== 'plugin' || $s['accent'] . $s['bg'] . $s['ink'] . $s['font_body'] . $s['font_head'] !== '';
        // solo i @font-face dei caratteri davvero usati dall'app
        $used = strtolower($r['font_body'] . ',' . $r['font_head']);
        $r['faces'] = [];
        if ($s['mode'] !== 'plugin') {
            foreach (array_merge(self::theme_faces(), (array) $s['faces']) as $f) {
                if ($used !== ',' && strpos($used, strtolower($f['family'])) !== false) {
                    $r['faces'][] = $f;
                }
            }
        }
        $r['logo'] = $s['logo'] === 'icon' && function_exists('get_site_icon_url') ? get_site_icon_url(128) : '';
        if ($r['logo'] && !self::same_site($r['logo'])) {
            $r['logo'] = '';
        }
        $r['detected'] = $d;
        $r['theme'] = get_stylesheet();
        self::$cache = $r;
        return $r;
    }

    /** Colore principale effettivo (per theme-color e manifest). */
    public static function accent()
    {
        $r = self::resolved();
        return self::hex(self::light_palette($r)['accent']);
    }

    public static function background()
    {
        $r = self::resolved();
        return self::hex(self::light_palette($r)['surface']);
    }

    /** Tavolozza «chiara» (quella del sito, anche se il sito è scuro). */
    private static function light_palette($r)
    {
        $acc = self::parse_color($r['accent']) ?: self::parse_color(self::DEFAULT_ACCENT);
        $bg = self::parse_color($r['bg']);
        $ink = self::parse_color($r['ink']);
        if (!$bg) {
            $bg = self::mix([251, 252, 251], $acc, .015);
        }
        if (!$ink || self::contrast($ink, $bg) < 4.5) {
            $ink = self::lum($bg) > .4 ? self::mix([23, 33, 30], $acc, .08) : self::mix([232, 238, 235], $acc, .06);
        }
        return self::derive($bg, $ink, $acc);
    }

    /** Tavolozza scura: quella del sito se il sito è scuro, altrimenti ricavata dal colore principale. */
    private static function dark_palette($r)
    {
        $light = self::light_palette($r);
        if (self::lum($light['surface']) < .18) {
            return $light;
        }
        $acc = self::parse_color($r['accent']) ?: self::parse_color(self::DEFAULT_ACCENT);
        $bg = self::mix([18, 20, 22], $acc, .06);
        $ink = self::mix([230, 232, 234], $acc, .05);
        return self::derive($bg, $ink, $acc);
    }

    /** Tutta la tavolozza da sfondo, testo e colore principale. */
    private static function derive($bg, $ink, $acc)
    {
        $dark = self::lum($bg) < .18;
        $p = [];
        $p['surface'] = $bg;
        $p['ink'] = $ink;
        $p['bg'] = self::mix($bg, $dark ? [0, 0, 0] : $ink, $dark ? .35 : .08);
        $p['surface-2'] = self::mix($bg, $ink, $dark ? .06 : .045);
        $p['surface-3'] = self::mix($bg, $ink, $dark ? .11 : .09);
        $p['line'] = self::mix($bg, $ink, $dark ? .15 : .14);
        $p['muted'] = self::mix($ink, $bg, .36);
        while (self::contrast($p['muted'], $bg) < 4.5 && self::contrast($p['muted'], $ink) > 1.05) {
            $p['muted'] = self::mix($p['muted'], $ink, .15);
        }
        $p['paper'] = $dark ? self::mix($bg, [255, 255, 255], .02) : [255, 255, 255];
        $p['paper-dot'] = self::mix($p['paper'], $ink, $dark ? .18 : .15);
        // il colore principale deve leggersi come testo/icona sullo sfondo (almeno 3:1)
        $a = $acc;
        if ($dark && !self::colorful($acc) && self::lum($acc) < .4) {
            // sito monocromatico (pulsanti neri): al buio i pulsanti diventano chiari
            $a = self::mix($ink, $bg, .04);
        }
        for ($i = 0; $i < 20 && self::contrast($a, $bg) < 3; $i++) {
            $a = self::mix($a, $dark ? [255, 255, 255] : [0, 0, 0], .1);
        }
        $p['accent'] = $a;
        // testo bianco sui pulsanti come fanno quasi tutti i siti, se si legge (pulsanti in grassetto: 3:1)
        $p['accent-ink'] = self::contrast([255, 255, 255], $a) >= 3 ? [255, 255, 255] : self::mix([12, 18, 16], $a, .15);
        $p['accent-soft'] = self::mix($bg, $a, $dark ? .22 : .14);
        $p['scheme'] = $dark ? 'dark' : 'light';
        return $p;
    }

    private static function vars($p)
    {
        $css = '';
        foreach (['bg', 'surface', 'surface-2', 'surface-3', 'ink', 'muted', 'line', 'accent', 'accent-ink', 'accent-soft', 'paper', 'paper-dot'] as $k) {
            $css .= '--' . $k . ':' . self::hex($p[$k]) . ';';
        }
        $css .= '--scrim:' . ($p['scheme'] === 'dark' ? 'rgba(0,0,0,.55)' : 'rgba(10,20,17,.38)') . ';';
        $css .= '--accent-shadow:' . self::rgba($p['accent'], .45) . ';';
        return $css . 'color-scheme:' . $p['scheme'];
    }

    /** CSS da mettere dopo app.css. Stringa vuota = aspetto originale. */
    public static function app_css()
    {
        $r = self::resolved();
        if (!$r['custom']) {
            return '';
        }
        $l = self::light_palette($r);
        $d = self::dark_palette($r);
        $css = self::faces_css($r['faces']);
        $font = '';
        if ($r['font_body'] !== '') {
            $font .= '--f-body:' . $r['font_body'] . ',' . self::FALLBACK_BODY . ';';
        }
        if ($r['font_head'] !== '' || $r['font_body'] !== '') {
            $font .= '--f-display:' . ($r['font_head'] !== '' ? $r['font_head'] : $r['font_body']) . ',' . self::FALLBACK_HEAD . ';';
        }
        $css .= ':root{' . $font . self::vars($l) . '}';
        $css .= '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' . self::vars($d) . '}}';
        $css .= ':root[data-theme="dark"]{' . self::vars($d) . '}';
        $css .= ':root[data-theme="light"]{' . self::vars($l) . '}';
        if ($r['logo']) {
            $css .= '.boot .logo,.lock>.logo,.lock .logo:first-child{background:var(--surface) url("' . self::css_url($r['logo']) . '") center/cover no-repeat;color:transparent;font-size:0;box-shadow:0 0 0 1px var(--line)}';
        }
        return $css;
    }

    /** Variabili per la pagina pubblica dei dati di accesso (access.css). */
    public static function access_css()
    {
        $r = self::resolved();
        if (!$r['custom']) {
            return '';
        }
        $map = function ($p) {
            return '--bg:' . self::hex($p['bg']) . ';--card:' . self::hex($p['surface']) . ';--ink:' . self::hex($p['ink']) . ';--muted:' . self::hex($p['muted'])
                . ';--line:' . self::hex($p['line']) . ';--accent:' . self::hex($p['accent']) . ';--accent-ink:' . self::hex($p['accent-ink']) . ';--soft:' . self::hex($p['surface-2']);
        };
        $css = self::faces_css($r['faces']);
        $font = $r['font_body'] !== '' ? 'body{font-family:' . $r['font_body'] . ',' . self::FALLBACK_BODY . '}' : '';
        $css .= ':root{' . $map(self::light_palette($r)) . '}@media (prefers-color-scheme:dark){:root{' . $map(self::dark_palette($r)) . '}}' . $font;
        return $css;
    }

    private static function faces_css($faces)
    {
        $css = '';
        foreach ($faces as $f) {
            $src = [];
            foreach ($f['src'] as $u) {
                $fmt = '';
                if (preg_match('/\.(woff2|woff|ttf|otf)(\?|$)/i', $u, $m)) {
                    $fmt = ' format("' . ['woff2' => 'woff2', 'woff' => 'woff', 'ttf' => 'truetype', 'otf' => 'opentype'][strtolower($m[1])] . '")';
                }
                $src[] = 'url("' . self::css_url($u) . '")' . $fmt;
            }
            $css .= '@font-face{font-family:"' . $f['family'] . '";font-style:' . $f['style'] . ';font-weight:' . $f['weight'] . ';' . ($f['stretch'] ? 'font-stretch:' . $f['stretch'] . ';' : '') . 'font-display:swap;src:' . implode(',', $src) . '}';
        }
        return $css;
    }

    // ===================== pulizia dei valori =====================

    /** Nomi di caratteri: solo lettere, cifre, spazi, virgole, trattini e virgolette. */
    public static function clean_family($v)
    {
        $v = html_entity_decode(wp_strip_all_tags($v), ENT_QUOTES, 'UTF-8');
        $v = preg_replace('/[^\p{L}\p{N} ,\'"_\-]/u', '', $v);
        $v = trim(preg_replace('/\s+/', ' ', $v), " ,");
        // virgolette bilanciate, altrimenti le togliamo tutte
        if (substr_count($v, '"') % 2 || substr_count($v, "'") % 2) {
            $v = str_replace(['"', "'"], '', $v);
        }
        return substr($v, 0, 200);
    }

    private static function clean_faces($faces)
    {
        $out = [];
        foreach (array_slice($faces, 0, 24) as $f) {
            if (!is_array($f)) {
                continue;
            }
            $fam = str_replace(['"', "'", ','], '', self::clean_family((string) ($f['family'] ?? '')));
            $w = preg_replace('/[^0-9 a-z]/', '', strtolower((string) ($f['weight'] ?? '400')));
            $st = preg_match('/^(normal|italic|oblique)$/', (string) ($f['style'] ?? 'normal')) ? $f['style'] : 'normal';
            $sx = preg_replace('/[^0-9 a-z%]/', '', strtolower((string) ($f['stretch'] ?? '')));
            $src = [];
            foreach ((array) ($f['src'] ?? []) as $u) {
                $u = is_string($u) ? trim($u) : '';
                if ($u !== '' && self::same_site($u) && preg_match('/\.(woff2|woff|ttf|otf)(\?[^"\'()\s]*)?$/i', $u)) {
                    $src[] = esc_url_raw($u);
                }
            }
            if ($fam === '' || !$src) {
                continue;
            }
            $key = strtolower($fam . '|' . $w . '|' . $st . '|' . implode(' ', $src));
            if (isset($out[$key])) {
                continue;
            }
            $out[$key] = ['family' => $fam, 'weight' => $w !== '' ? substr($w, 0, 20) : '400', 'style' => $st, 'stretch' => substr($sx, 0, 20), 'src' => array_slice($src, 0, 3)];
        }
        return array_values($out);
    }

    /** Solo URL http(s) dello stesso host del sito: la CSP dell'app ammette solo 'self'. */
    private static function same_site($u)
    {
        $h = wp_parse_url(home_url('/'), PHP_URL_HOST);
        $p = wp_parse_url($u);
        return is_array($p) && in_array($p['scheme'] ?? '', ['http', 'https'], true) && isset($p['host']) && strcasecmp($p['host'], $h) === 0;
    }

    private static function css_url($u)
    {
        return str_replace(['"', "'", '(', ')', '\\', ' ', "\n", "\r"], ['%22', '%27', '%28', '%29', '%5C', '%20', '', ''], esc_url_raw($u));
    }

    // ===================== colori =====================

    /** [r,g,b] da #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl() o pochi nomi. null se non si capisce o è trasparente. */
    public static function parse_color($v)
    {
        $v = strtolower(trim((string) $v));
        $names = ['white' => '#ffffff', 'black' => '#000000'];
        if (isset($names[$v])) {
            $v = $names[$v];
        }
        if (preg_match('/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/', $v, $m)) {
            $h = $m[1];
            if (strlen($h) === 3) {
                $h = $h[0] . $h[0] . $h[1] . $h[1] . $h[2] . $h[2];
            }
            if (strlen($h) === 8 && hexdec(substr($h, 6, 2)) < 128) {
                return null;
            }
            return [hexdec(substr($h, 0, 2)), hexdec(substr($h, 2, 2)), hexdec(substr($h, 4, 2))];
        }
        if (preg_match('/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,\/]\s*([\d.]+%?))?\s*\)$/', $v, $m)) {
            if (isset($m[4]) && $m[4] !== '' && (float) $m[4] < (substr($m[4], -1) === '%' ? 50 : .5)) {
                return null;
            }
            return [min(255, (int) round($m[1])), min(255, (int) round($m[2])), min(255, (int) round($m[3]))];
        }
        if (preg_match('/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/', $v, $m)) {
            return self::hsl2rgb((float) $m[1], (float) $m[2] / 100, (float) $m[3] / 100);
        }
        return null;
    }

    private static function hsl2rgb($h, $s, $l)
    {
        $c = (1 - abs(2 * $l - 1)) * $s;
        $x = $c * (1 - abs(fmod($h / 60, 2) - 1));
        $m = $l - $c / 2;
        $k = (int) floor(fmod($h, 360) / 60);
        $t = [[$c, $x, 0], [$x, $c, 0], [0, $c, $x], [0, $x, $c], [$x, 0, $c], [$c, 0, $x]][max(0, min(5, $k))];
        return [(int) round(($t[0] + $m) * 255), (int) round(($t[1] + $m) * 255), (int) round(($t[2] + $m) * 255)];
    }

    public static function hex($c)
    {
        if (is_string($c)) {
            $c = self::parse_color($c);
        }
        return $c ? sprintf('#%02X%02X%02X', $c[0], $c[1], $c[2]) : '';
    }

    private static function rgba($c, $a)
    {
        return 'rgba(' . (int) $c[0] . ',' . (int) $c[1] . ',' . (int) $c[2] . ',' . $a . ')';
    }

    private static function mix($a, $b, $t)
    {
        return [(int) round($a[0] + ($b[0] - $a[0]) * $t), (int) round($a[1] + ($b[1] - $a[1]) * $t), (int) round($a[2] + ($b[2] - $a[2]) * $t)];
    }

    private static function lum($c)
    {
        $f = function ($v) {
            $v /= 255;
            return $v <= .03928 ? $v / 12.92 : pow(($v + .055) / 1.055, 2.4);
        };
        return .2126 * $f($c[0]) + .7152 * $f($c[1]) + .0722 * $f($c[2]);
    }

    private static function contrast($a, $b)
    {
        $x = self::lum($a);
        $y = self::lum($b);
        return (max($x, $y) + .05) / (min($x, $y) + .05);
    }

    /** Un colore «di marca»: abbastanza saturo e né quasi bianco né quasi nero. */
    private static function colorful($v)
    {
        $c = is_array($v) ? $v : self::parse_color($v);
        if (!$c) {
            return false;
        }
        $mx = max($c);
        $mn = min($c);
        $l = ($mx + $mn) / 510;
        $s = $mx === $mn ? 0 : ($mx - $mn) / 255 / (1 - abs(2 * $l - 1));
        return $s > .18 && $l > .12 && $l < .9;
    }

    /** Palette chiara/scura effettive in esadecimale, per l'anteprima nell'amministrazione. */
    public static function preview()
    {
        $r = self::resolved();
        $h = function ($p) {
            $o = [];
            foreach ($p as $k => $v) {
                $o[$k] = is_array($v) ? self::hex($v) : $v;
            }
            return $o;
        };
        return ['light' => $h(self::light_palette($r)), 'dark' => $h(self::dark_palette($r)), 'r' => $r];
    }
}

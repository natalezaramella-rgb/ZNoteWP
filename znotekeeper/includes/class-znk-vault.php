<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * «I miei secrets»: gestore di password con condivisione tra gli utenti
 * abilitati dello stesso sito.
 *
 * Il sito non vede mai nulla in chiaro:
 * - ogni utente ha due coppie di chiavi P-256 create nel browser (ECDH per
 *   ricevere le chiavi delle voci, ECDSA per firmare). Le chiavi private sono
 *   cifrate con la chiave dello spazio dell'utente; qui arrivano solo cifrate;
 * - ogni voce ha una propria chiave AES-256 casuale. Il contenuto è cifrato e
 *   firmato da chi lo scrive; la chiave della voce è «avvolta» (ECDH effimero +
 *   HKDF + AES-GCM) una volta per ciascun utente che può leggerla;
 * - il proprietario firma l'elenco dei membri e dei permessi (ACL), così un
 *   browser può accorgersi se qualcuno, sito compreso, ha alterato i permessi;
 * - togliere un utente obbliga a cambiare la chiave della voce (rotazione):
 *   il contenuto viene ricifrato e la nuova chiave avvolta solo per chi resta.
 *
 * Il sito fa rispettare i permessi (solo proprietario e «può modificare»
 * scrivono, solo il proprietario condivide) e sa chi vede quale voce, ma non
 * cosa contiene.
 */
class ZNK_Vault
{
    const DB_VERSION = '1';
    const MAX_DATA = 256 * 1024;
    const MAX_MEMBERS = 50;

    public static function t($n)
    {
        return ZNK_DB::t($n);
    }

    public static function init()
    {
        if (get_option('znk_vault_db') !== self::DB_VERSION) {
            self::install();
        }
        add_action('rest_api_init', [__CLASS__, 'routes']);
    }

    public static function install()
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $c = $wpdb->get_charset_collate();
        $k = self::t('vkeys');
        $e = self::t('ventries');
        $a = self::t('vaccess');
        dbDelta("CREATE TABLE $k (
  user_id BIGINT UNSIGNED NOT NULL,
  pub_enc TEXT NOT NULL,
  pub_sig TEXT NOT NULL,
  priv LONGTEXT NOT NULL,
  fp CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY  (user_id)
) $c;");
        dbDelta("CREATE TABLE $e (
  id VARCHAR(40) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  rev INT UNSIGNED NOT NULL DEFAULT 1,
  kv INT UNSIGNED NOT NULL DEFAULT 1,
  data LONGTEXT NOT NULL,
  acl LONGTEXT NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  trashed_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY  (id),
  KEY owner_id (owner_id)
) $c;");
        dbDelta("CREATE TABLE $a (
  entry_id VARCHAR(40) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  perm VARCHAR(8) NOT NULL,
  kv INT UNSIGNED NOT NULL DEFAULT 1,
  wrapped TEXT NOT NULL,
  folder_id VARCHAR(40) NULL,
  fav TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  PRIMARY KEY  (entry_id,user_id),
  KEY user_id (user_id)
) $c;");
        update_option('znk_vault_db', self::DB_VERSION);
    }

    public static function drop()
    {
        global $wpdb;
        foreach (['vkeys', 'ventries', 'vaccess'] as $n) {
            $wpdb->query('DROP TABLE IF EXISTS ' . self::t($n));
        }
        delete_option('znk_vault_db');
    }

    /** Cancellazione dello spazio di un utente: le sue voci spariscono anche per chi le aveva condivise. */
    public static function delete_user($uid)
    {
        global $wpdb;
        $uid = (int) $uid;
        $ids = $wpdb->get_col($wpdb->prepare('SELECT id FROM ' . self::t('ventries') . ' WHERE owner_id = %d', $uid));
        foreach ($ids as $id) {
            $wpdb->delete(self::t('vaccess'), ['entry_id' => $id]);
        }
        $wpdb->delete(self::t('ventries'), ['owner_id' => $uid]);
        $wpdb->delete(self::t('vaccess'), ['user_id' => $uid]);
        $wpdb->delete(self::t('vkeys'), ['user_id' => $uid]);
    }

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
        $id = '(?P<id>[A-Za-z0-9_-]{1,40})';
        self::r('/vault/keys', 'GET', 'keys_get');
        self::r('/vault/keys', 'POST', 'keys_set');
        self::r('/vault/people', 'GET', 'people');
        self::r('/vault', 'GET', 'all');
        self::r("/vault/$id", 'PUT', 'put');
        self::r("/vault/$id", 'DELETE', 'purge');
        self::r("/vault/$id/access", 'PUT', 'access');
        self::r("/vault/$id/mine", 'PUT', 'mine');
        self::r("/vault/$id/mine", 'DELETE', 'leave');
        self::r("/vault/$id/trash", 'POST', 'trash');
    }

    private static function err($code, $msg, $status = 400, $extra = [])
    {
        return new WP_Error($code, $msg, ['status' => $status] + $extra);
    }

    private static function json($req)
    {
        $p = $req->get_json_params();
        return is_array($p) ? $p : [];
    }

    private static function uid($ctx)
    {
        return (int) $ctx['user']->user_id;
    }

    // ===================== Forme dei dati (solo controlli di forma) =====================

    private static function b64($v, $min, $max)
    {
        if (!is_string($v) || strlen($v) > $max * 2) {
            return false;
        }
        $raw = base64_decode($v, true);
        return $raw !== false && strlen($raw) >= $min && strlen($raw) <= $max;
    }

    /** Chiave pubblica P-256 in formato SPKI (91 byte). */
    private static function valid_spki($v)
    {
        if (!self::b64($v, 91, 91)) {
            return false;
        }
        $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split($v, 64, "\n") . "-----END PUBLIC KEY-----\n";
        $k = openssl_pkey_get_public($pem);
        if ($k === false) {
            return false;
        }
        $d = openssl_pkey_get_details($k);
        return isset($d['ec']['curve_name']) && $d['ec']['curve_name'] === 'prime256v1';
    }

    private static function valid_box($v, $max = 8192)
    {
        return is_array($v) && self::b64(isset($v['iv']) ? $v['iv'] : null, 12, 12) && self::b64(isset($v['ct']) ? $v['ct'] : null, 16, $max);
    }

    /** Chiave della voce avvolta per un utente: chiave effimera + scatola AES-GCM. */
    private static function valid_wrapped($v)
    {
        return is_array($v) && self::valid_spki(isset($v['e']) ? $v['e'] : null) && self::valid_box($v, 64);
    }

    /** Contenuto cifrato e firmato: {v, by, n, iv, ct, sig}. */
    private static function valid_data($v, $uid)
    {
        return is_array($v) && isset($v['by']) && (int) $v['by'] === $uid
            && self::valid_box($v, self::MAX_DATA) && self::b64(isset($v['sig']) ? $v['sig'] : null, 64, 64);
    }

    /** ACL firmata dal proprietario: {acl: testo JSON, sig}. Il sito controlla che dica le stesse cose che salva. */
    private static function valid_acl($v, $id, $owner, $kv, array $members)
    {
        if (!is_array($v) || !is_string(isset($v['acl']) ? $v['acl'] : null) || strlen($v['acl']) > 16384 || !self::b64(isset($v['sig']) ? $v['sig'] : null, 64, 64)) {
            return false;
        }
        $a = json_decode($v['acl'], true);
        if (!is_array($a) || (isset($a['id']) ? $a['id'] : null) !== $id || (int) (isset($a['owner']) ? $a['owner'] : 0) !== $owner || (int) (isset($a['kv']) ? $a['kv'] : 0) !== $kv || !isset($a['m']) || !is_array($a['m'])) {
            return false;
        }
        $m = [];
        foreach ($a['m'] as $k => $perm) {
            $m[(int) $k] = (string) $perm;
        }
        ksort($m);
        ksort($members);
        return $m === $members;
    }

    private static function now()
    {
        return ZNK_DB::now();
    }

    // ===================== Chiavi degli utenti =====================

    public static function keys_get($req, $ctx)
    {
        global $wpdb;
        $r = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('vkeys') . ' WHERE user_id = %d', self::uid($ctx)));
        if (!$r) {
            return ['keys' => null, 'uid' => self::uid($ctx)];
        }
        return ['uid' => self::uid($ctx), 'keys' => ['pub_enc' => $r->pub_enc, 'pub_sig' => $r->pub_sig, 'priv' => json_decode($r->priv, true), 'fp' => $r->fp]];
    }

    public static function keys_set($req, $ctx)
    {
        global $wpdb;
        $uid = self::uid($ctx);
        $p = self::json($req);
        if (!self::valid_spki(isset($p['pub_enc']) ? $p['pub_enc'] : null) || !self::valid_spki(isset($p['pub_sig']) ? $p['pub_sig'] : null) || !self::valid_box(isset($p['priv']) ? $p['priv'] : null, 4096)) {
            return self::err('znk_bad', 'Chiavi non valide.');
        }
        $t = self::t('vkeys');
        // Le chiavi non si sostituiscono: chi ha condiviso qualcosa con te si fida di queste.
        $ok = $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO $t (user_id, pub_enc, pub_sig, priv, fp, created_at) VALUES (%d, %s, %s, %s, %s, %s)",
            $uid, $p['pub_enc'], $p['pub_sig'], wp_json_encode($p['priv']), self::fp($uid, $p['pub_enc'], $p['pub_sig']), self::now()
        ));
        if (!$ok) {
            return self::err('znk_exists', 'Le chiavi di condivisione esistono già.', 409);
        }
        return self::keys_get($req, $ctx);
    }

    /** Impronta della chiave: la stessa formula è calcolata nel browser, che non si fida di questa. */
    public static function fp($uid, $enc, $sig)
    {
        return hash('sha256', 'znk-fp-v1|' . (int) $uid . '|' . $enc . '|' . $sig);
    }

    private static function person($uid, $k = null)
    {
        $wp = get_userdata($uid);
        $o = ['id' => (int) $uid, 'name' => $wp ? $wp->display_name : 'Utente eliminato', 'login' => $wp ? $wp->user_login : ''];
        if ($k) {
            $o['pub_enc'] = $k->pub_enc;
            $o['pub_sig'] = $k->pub_sig;
        }
        return $o;
    }

    /** Utenti del sito abilitati a ZNoteKeeper e con le chiavi pronte: a loro si può condividere. */
    public static function people($req, $ctx)
    {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT k.* FROM ' . self::t('vkeys') . ' k JOIN ' . ZNK_DB::t('users') . ' u ON u.user_id = k.user_id WHERE u.enabled = 1 AND k.user_id <> %d',
            self::uid($ctx)
        ));
        $out = [];
        foreach ($rows as $r) {
            $out[] = self::person((int) $r->user_id, $r);
        }
        usort($out, function ($a, $b) {
            return strcasecmp($a['name'], $b['name']);
        });
        return $out;
    }

    private static function keys_of(array $uids)
    {
        global $wpdb;
        $uids = array_values(array_unique(array_map('intval', $uids)));
        if (!$uids) {
            return [];
        }
        $rows = $wpdb->get_results('SELECT * FROM ' . self::t('vkeys') . ' WHERE user_id IN (' . implode(',', $uids) . ')');
        $m = [];
        foreach ($rows as $r) {
            $m[(int) $r->user_id] = $r;
        }
        return $m;
    }

    // ===================== Voci =====================

    private static function entry($id)
    {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('ventries') . ' WHERE id = %s', $id));
    }

    private static function my_access($id, $uid)
    {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('vaccess') . ' WHERE entry_id = %s AND user_id = %d', $id, $uid));
    }

    private static function members($id)
    {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare('SELECT user_id, perm, kv, folder_id, fav FROM ' . self::t('vaccess') . ' WHERE entry_id = %s', $id));
    }

    private static function out_entry($e, $a, $members)
    {
        $m = [];
        foreach ($members as $x) {
            $m[] = ['user_id' => (int) $x->user_id, 'perm' => $x->perm];
        }
        return [
            'id' => $e->id,
            'owner' => (int) $e->owner_id,
            'rev' => (int) $e->rev,
            'kv' => (int) $e->kv,
            'data' => json_decode($e->data, true),
            'acl' => json_decode($e->acl, true),
            'updated_by' => (int) $e->updated_by,
            'updated_at' => $e->updated_at . 'Z',
            'created_at' => $e->created_at . 'Z',
            'trashed_at' => $e->trashed_at ? $e->trashed_at . 'Z' : null,
            'perm' => $a->perm,
            'wrapped' => json_decode($a->wrapped, true),
            'wkv' => (int) $a->kv,
            'folder_id' => $a->folder_id,
            'fav' => (int) $a->fav === 1,
            'members' => $m,
        ];
    }

    /** Tutte le voci che l'utente può leggere (sue e condivise con lui). */
    public static function all($req, $ctx)
    {
        global $wpdb;
        $uid = self::uid($ctx);
        $at = self::t('vaccess');
        $et = self::t('ventries');
        $acc = $wpdb->get_results($wpdb->prepare("SELECT a.* FROM $at a JOIN $et e ON e.id = a.entry_id WHERE a.user_id = %d AND (e.trashed_at IS NULL OR e.owner_id = %d)", $uid, $uid));
        // Impronta dello stato: se non è cambiato niente si risponde in poche righe.
        $ids = [];
        foreach ($acc as $a) {
            $ids[] = $a->entry_id;
        }
        $entries = [];
        $mem = [];
        if ($ids) {
            $in = implode(',', array_map(function ($x) use ($wpdb) {
                return $wpdb->prepare('%s', $x);
            }, $ids));
            foreach ($wpdb->get_results("SELECT * FROM $et WHERE id IN ($in)") as $e) {
                $entries[$e->id] = $e;
            }
            foreach ($wpdb->get_results("SELECT entry_id, user_id, perm, kv, folder_id, fav FROM $at WHERE entry_id IN ($in)") as $m) {
                $mem[$m->entry_id][] = $m;
            }
        }
        $sig = [];
        foreach ($acc as $a) {
            $e = $entries[$a->entry_id];
            $sig[] = $a->entry_id . ':' . $e->rev . ':' . $e->kv . ':' . $a->perm . ':' . $a->folder_id . ':' . $a->fav . ':' . $e->trashed_at . ':' . count($mem[$a->entry_id]);
        }
        sort($sig);
        $stamp = substr(hash('sha256', implode('|', $sig)), 0, 24);
        if ((string) $req->get_param('stamp') === $stamp) {
            return ['same' => true, 'stamp' => $stamp];
        }
        $out = [];
        $uids = [$uid];
        foreach ($acc as $a) {
            $e = $entries[$a->entry_id];
            $out[] = self::out_entry($e, $a, $mem[$a->entry_id]);
            $uids[] = (int) $e->owner_id;
            $uids[] = (int) $e->updated_by;
            foreach ($mem[$a->entry_id] as $m) {
                $uids[] = (int) $m->user_id;
            }
        }
        // Chiavi pubbliche di tutti gli utenti nominati, per controllare le firme.
        $keys = self::keys_of($uids);
        $people = [];
        foreach (array_unique($uids) as $u) {
            $people[] = self::person($u, isset($keys[$u]) ? $keys[$u] : null);
        }
        return ['stamp' => $stamp, 'entries' => $out, 'people' => $people];
    }

    /** Crea una voce o ne aggiorna il contenuto (proprietario o «può modificare»). */
    public static function put($req, $ctx)
    {
        global $wpdb;
        $uid = self::uid($ctx);
        $id = (string) $req['id'];
        $p = self::json($req);
        $data = isset($p['data']) ? $p['data'] : null;
        if (!self::valid_data($data, $uid)) {
            return self::err('znk_bad', 'Dati non validi.');
        }
        $e = self::entry($id);
        $now = self::now();
        if (!$e) {
            // Nuova voce: il creatore è il proprietario e l'unico membro.
            $wr = isset($p['wrapped']) ? $p['wrapped'] : null;
            $acl = isset($p['acl']) ? $p['acl'] : null;
            if ((int) (isset($p['kv']) ? $p['kv'] : 0) !== 1 || !self::valid_wrapped($wr) || !self::valid_acl($acl, $id, $uid, 1, [$uid => 'owner'])) {
                return self::err('znk_bad', 'Dati non validi.');
            }
            if (!self::my_keys($uid)) {
                return self::err('znk_no_keys', 'Prima servono le chiavi di condivisione: riapri la sezione.', 409);
            }
            $ok = $wpdb->insert(self::t('ventries'), [
                'id' => $id, 'owner_id' => $uid, 'rev' => 1, 'kv' => 1, 'data' => wp_json_encode($data), 'acl' => wp_json_encode($acl),
                'updated_by' => $uid, 'created_at' => $now, 'updated_at' => $now,
            ]);
            if (!$ok) {
                return self::err('znk_conflict', 'Identificativo già usato.', 409);
            }
            $wpdb->insert(self::t('vaccess'), [
                'entry_id' => $id, 'user_id' => $uid, 'perm' => 'owner', 'kv' => 1, 'wrapped' => wp_json_encode($wr),
                'folder_id' => self::folder(isset($p['folder_id']) ? $p['folder_id'] : null), 'fav' => 0, 'created_at' => $now,
            ]);
            return self::one($id, $uid);
        }
        $a = self::my_access($id, $uid);
        if (!$a) {
            return self::err('znk_404', 'Voce non trovata.', 404);
        }
        if ($a->perm === 'read') {
            return self::err('znk_readonly', 'Questa voce ti è stata condivisa in sola lettura.', 403);
        }
        if ($e->trashed_at) {
            return self::err('znk_trashed', 'La voce è nel cestino.', 409);
        }
        if ((int) (isset($p['kv']) ? $p['kv'] : 0) !== (int) $e->kv || (int) (isset($p['base_rev']) ? $p['base_rev'] : 0) !== (int) $e->rev) {
            return self::err('znk_conflict', 'La voce è stata modificata nel frattempo.', 409, ['current' => self::one($id, $uid)]);
        }
        // Aggiornamento condizionato: due salvataggi contemporanei non si sovrascrivono.
        $n = $wpdb->query($wpdb->prepare(
            'UPDATE ' . self::t('ventries') . ' SET data = %s, rev = rev + 1, updated_by = %d, updated_at = %s WHERE id = %s AND rev = %d AND kv = %d',
            wp_json_encode($data), $uid, $now, $id, (int) $e->rev, (int) $e->kv
        ));
        if (!$n) {
            return self::err('znk_conflict', 'La voce è stata modificata nel frattempo.', 409, ['current' => self::one($id, $uid)]);
        }
        return self::one($id, $uid);
    }

    private static function my_keys($uid)
    {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . self::t('vkeys') . ' WHERE user_id = %d', $uid));
    }

    private static function folder($v)
    {
        return (is_string($v) && preg_match('/^[A-Za-z0-9_-]{1,40}$/', $v)) ? $v : null;
    }

    private static function one($id, $uid)
    {
        $e = self::entry($id);
        $a = self::my_access($id, $uid);
        return ($e && $a) ? self::out_entry($e, $a, self::members($id)) : null;
    }

    /**
     * Membri e permessi (solo il proprietario). Si manda l'elenco completo.
     * Chi viene tolto perde la chiave: la voce deve passare a una chiave nuova
     * (kv + 1) con il contenuto ricifrato e la chiave avvolta per chi resta.
     */
    public static function access($req, $ctx)
    {
        global $wpdb;
        $uid = self::uid($ctx);
        $id = (string) $req['id'];
        $p = self::json($req);
        $e = self::entry($id);
        if (!$e || (int) $e->owner_id !== $uid) {
            return self::err('znk_forbidden', 'Solo il proprietario può cambiare la condivisione.', 403);
        }
        if ((int) (isset($p['base_rev']) ? $p['base_rev'] : 0) !== (int) $e->rev) {
            return self::err('znk_conflict', 'La voce è stata modificata nel frattempo.', 409, ['current' => self::one($id, $uid)]);
        }
        $kv = (int) (isset($p['kv']) ? $p['kv'] : 0);
        $rotate = $kv === (int) $e->kv + 1;
        if (!$rotate && $kv !== (int) $e->kv) {
            return self::err('znk_bad', 'Versione della chiave non valida.');
        }
        $list = isset($p['members']) && is_array($p['members']) ? $p['members'] : [];
        if (count($list) > self::MAX_MEMBERS) {
            return self::err('znk_bad', 'Troppi utenti per una sola voce (massimo ' . self::MAX_MEMBERS . ').');
        }
        $old = [];
        foreach (self::members($id) as $m) {
            $old[(int) $m->user_id] = $m;
        }
        $new = [];
        $perms = [];
        foreach ($list as $m) {
            $mu = (int) (isset($m['user_id']) ? $m['user_id'] : 0);
            $perm = isset($m['perm']) ? (string) $m['perm'] : '';
            if (!$mu || isset($new[$mu]) || !in_array($perm, ['owner', 'read', 'write'], true) || ($perm === 'owner') !== ($mu === $uid)) {
                return self::err('znk_bad', 'Elenco degli utenti non valido.');
            }
            $w = isset($m['wrapped']) ? $m['wrapped'] : null;
            if ($w !== null && !self::valid_wrapped($w)) {
                return self::err('znk_bad', 'Chiave avvolta non valida.');
            }
            // Senza rotazione chi c'era già tiene la sua chiave; i nuovi e la rotazione la richiedono.
            if ($w === null && ($rotate || !isset($old[$mu]))) {
                return self::err('znk_bad', 'Manca la chiave per un utente.');
            }
            if ($mu !== $uid && !isset($old[$mu]) && (!ZNK_Users::is_enabled($mu) || !self::my_keys($mu))) {
                return self::err('znk_bad_user', 'Uno degli utenti scelti non può ricevere condivisioni.', 400);
            }
            $new[$mu] = ['perm' => $perm, 'wrapped' => $w];
            $perms[$mu] = $perm;
        }
        if (!isset($new[$uid])) {
            return self::err('znk_bad', 'Il proprietario deve restare nell\'elenco.');
        }
        foreach (array_keys($old) as $ou) {
            if (!isset($new[$ou]) && !$rotate) {
                return self::err('znk_need_rotate', 'Per togliere un utente serve una chiave nuova.', 409);
            }
        }
        $acl = isset($p['acl']) ? $p['acl'] : null;
        if (!self::valid_acl($acl, $id, $uid, $kv, $perms)) {
            return self::err('znk_bad', 'Elenco firmato non coerente.');
        }
        $data = isset($p['data']) ? $p['data'] : null;
        if ($rotate && !self::valid_data($data, $uid)) {
            return self::err('znk_bad', 'Con la chiave nuova serve il contenuto ricifrato.');
        }
        $now = self::now();
        $f = ['acl' => wp_json_encode($acl), 'kv' => $kv, 'rev' => (int) $e->rev + 1, 'updated_at' => $now];
        if ($rotate) {
            $f['data'] = wp_json_encode($data);
            $f['updated_by'] = $uid;
        }
        $wpdb->query('START TRANSACTION');
        $n = $wpdb->update(self::t('ventries'), $f, ['id' => $id, 'rev' => (int) $e->rev]);
        if (!$n) {
            $wpdb->query('ROLLBACK');
            return self::err('znk_conflict', 'La voce è stata modificata nel frattempo.', 409, ['current' => self::one($id, $uid)]);
        }
        $at = self::t('vaccess');
        foreach ($old as $ou => $m) {
            if (!isset($new[$ou])) {
                $wpdb->delete($at, ['entry_id' => $id, 'user_id' => $ou]);
            }
        }
        $added = [];
        foreach ($new as $mu => $m) {
            $row = ['perm' => $m['perm']];
            if ($m['wrapped'] !== null) {
                $row['wrapped'] = wp_json_encode($m['wrapped']);
                $row['kv'] = $kv;
            }
            if (isset($old[$mu])) {
                $wpdb->update($at, $row, ['entry_id' => $id, 'user_id' => $mu]);
            } else {
                $wpdb->insert($at, $row + ['entry_id' => $id, 'user_id' => $mu, 'kv' => $kv, 'folder_id' => null, 'fav' => 0, 'created_at' => $now]);
                $added[] = $mu;
            }
        }
        $wpdb->query('COMMIT');
        $me = get_userdata($uid);
        foreach ($added as $mu) {
            ZNK_Users::notify(
                $mu,
                'un secret condiviso con te',
                ($me ? $me->display_name : 'Un utente') . " ha condiviso con te una voce di «I miei secrets».\n\n"
                . "La trovi in ZNoteKeeper › I miei secrets › Condivisi con me. Il contenuto è cifrato: si legge solo dall'app, dopo lo sblocco."
            );
        }
        return self::one($id, $uid);
    }

    /** Cartella e preferito: sono personali, ognuno li sceglie per sé. */
    public static function mine($req, $ctx)
    {
        global $wpdb;
        $uid = self::uid($ctx);
        $id = (string) $req['id'];
        if (!self::my_access($id, $uid)) {
            return self::err('znk_404', 'Voce non trovata.', 404);
        }
        $p = self::json($req);
        $f = [];
        if (array_key_exists('folder_id', $p)) {
            $f['folder_id'] = self::folder($p['folder_id']);
        }
        if (array_key_exists('fav', $p)) {
            $f['fav'] = $p['fav'] ? 1 : 0;
        }
        if ($f) {
            $wpdb->update(self::t('vaccess'), $f, ['entry_id' => $id, 'user_id' => $uid]);
        }
        return self::one($id, $uid);
    }

    /** Chi ha ricevuto una voce può toglierla dai suoi secrets. */
    public static function leave($req, $ctx)
    {
        global $wpdb;
        $uid = self::uid($ctx);
        $a = self::my_access((string) $req['id'], $uid);
        if (!$a) {
            return ['ok' => true];
        }
        if ($a->perm === 'owner') {
            return self::err('znk_bad', 'Sei il proprietario: usa «Elimina».');
        }
        $wpdb->delete(self::t('vaccess'), ['entry_id' => (string) $req['id'], 'user_id' => $uid]);
        return ['ok' => true];
    }

    /** Cestino: una voce cestinata sparisce per chi l'ha ricevuta finché il proprietario non la ripristina. */
    public static function trash($req, $ctx)
    {
        global $wpdb;
        $uid = self::uid($ctx);
        $e = self::entry((string) $req['id']);
        if (!$e || (int) $e->owner_id !== $uid) {
            return self::err('znk_forbidden', 'Solo il proprietario può eliminare la voce.', 403);
        }
        $p = self::json($req);
        $wpdb->update(self::t('ventries'), ['trashed_at' => empty($p['trashed']) ? null : self::now()], ['id' => $e->id]);
        return self::one($e->id, $uid);
    }

    public static function purge($req, $ctx)
    {
        global $wpdb;
        $uid = self::uid($ctx);
        $e = self::entry((string) $req['id']);
        if (!$e) {
            return ['ok' => true];
        }
        if ((int) $e->owner_id !== $uid) {
            return self::err('znk_forbidden', 'Solo il proprietario può eliminare la voce.', 403);
        }
        $wpdb->delete(self::t('vaccess'), ['entry_id' => $e->id]);
        $wpdb->delete(self::t('ventries'), ['id' => $e->id]);
        return ['ok' => true];
    }
}

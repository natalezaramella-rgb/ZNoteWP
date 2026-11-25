<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Promemoria via Web Push senza contenuto (punto 9): il server sa solo che
 * c'è un'attività in scadenza, non quale. Il service worker mostra un avviso
 * generico; il titolo compare nei promemoria creati dal dispositivo.
 */
class ZNK_Push
{
    private static function b64u($s)
    {
        return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    }

    public static function ensure_keys()
    {
        $k = get_option('znk_vapid');
        if (is_array($k) && !empty($k['pub']) && !empty($k['priv'])) {
            return $k;
        }
        if (!function_exists('openssl_pkey_new')) {
            return null;
        }
        $res = @openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        if (!$res) {
            return null;
        }
        $pem = '';
        if (!@openssl_pkey_export($res, $pem)) {
            return null;
        }
        $d = openssl_pkey_get_details($res);
        $x = str_pad($d['ec']['x'], 32, "\0", STR_PAD_LEFT);
        $y = str_pad($d['ec']['y'], 32, "\0", STR_PAD_LEFT);
        $k = ['pub' => self::b64u("\x04" . $x . $y), 'priv' => ZNK_Secret::encrypt($pem, ZNK_Secret::key_for('vapid'))];
        update_option('znk_vapid', $k, false);
        return $k;
    }

    public static function public_key()
    {
        $k = self::ensure_keys();
        return $k ? $k['pub'] : null;
    }

    /** Converte una firma ECDSA DER nel formato JOSE (r||s, 64 byte). */
    private static function der_to_jose($der)
    {
        $pos = 2;
        if (ord($der[1]) & 0x80) {
            $pos += ord($der[1]) & 0x7f;
        }
        $parts = [];
        for ($i = 0; $i < 2; $i++) {
            $pos++; // 0x02
            $len = ord($der[$pos]);
            $pos++;
            $v = substr($der, $pos, $len);
            $pos += $len;
            $v = ltrim($v, "\0");
            $parts[] = str_pad($v, 32, "\0", STR_PAD_LEFT);
        }
        return $parts[0] . $parts[1];
    }

    public static function send($endpoint)
    {
        $k = self::ensure_keys();
        if (!$k) {
            return false;
        }
        $pem = ZNK_Secret::decrypt($k['priv'], ZNK_Secret::key_for('vapid'));
        $p = wp_parse_url($endpoint);
        if (!$pem || empty($p['host'])) {
            return false;
        }
        $aud = $p['scheme'] . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
        $head = self::b64u(wp_json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
        $claims = self::b64u(wp_json_encode(['aud' => $aud, 'exp' => time() + 12 * 3600, 'sub' => 'mailto:' . get_option('admin_email')]));
        $sig = '';
        if (!openssl_sign("$head.$claims", $sig, $pem, OPENSSL_ALGO_SHA256)) {
            return false;
        }
        $jwt = "$head.$claims." . self::b64u(self::der_to_jose($sig));
        // wp_safe_remote_post rifiuta indirizzi interni (127.0.0.1, reti private): niente SSRF tramite endpoint finti.
        $r = wp_safe_remote_post($endpoint, [
            'timeout' => 10,
            'headers' => ['TTL' => '3600', 'Urgency' => 'high', 'Authorization' => 'vapid t=' . $jwt . ', k=' . $k['pub'], 'Content-Length' => '0'],
            'body' => '',
        ]);
        if (is_wp_error($r)) {
            return false;
        }
        return (int) wp_remote_retrieve_response_code($r);
    }

    /** Invia i promemoria scaduti (una notifica per utente e giro). */
    public static function run()
    {
        global $wpdb;
        $it = ZNK_DB::t('items');
        $now = ZNK_DB::now();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT user_id, id FROM $it WHERE remind_at IS NOT NULL AND remind_at <= %s AND remind_at > %s AND reminded = 0 AND completed = 0 AND deleted_at IS NULL AND purged = 0 LIMIT 500",
            $now,
            gmdate('Y-m-d H:i:s', time() - DAY_IN_SECONDS)
        ));
        $users = [];
        foreach ($rows as $r) {
            $users[(int) $r->user_id][] = $r->id;
        }
        foreach ($users as $uid => $ids) {
            $devs = $wpdb->get_results($wpdb->prepare('SELECT id, push_endpoint FROM ' . ZNK_DB::t('devices') . ' WHERE user_id = %d AND push_endpoint IS NOT NULL', $uid));
            foreach ($devs as $d) {
                $code = self::send($d->push_endpoint);
                if ($code === 404 || $code === 410) {
                    $wpdb->update(ZNK_DB::t('devices'), ['push_endpoint' => null], ['id' => $d->id]);
                }
            }
            $in = implode(',', array_fill(0, count($ids), '%s'));
            $wpdb->query($wpdb->prepare("UPDATE $it SET reminded = 1 WHERE user_id = %d AND id IN ($in)", array_merge([$uid], $ids)));
        }
    }
}

<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Segreti lato server: chiave del sito (derivata dai salt di wp-config.php
 * più un valore casuale nel database), cifratura simmetrica AES-256-GCM e
 * "sigillo" con la chiave pubblica RSA dell'utente per le email in arrivo.
 */
class ZNK_Secret
{
    public static function site_key()
    {
        $rnd = get_option('znk_site_secret');
        if (!$rnd) {
            $rnd = bin2hex(random_bytes(32));
            add_option('znk_site_secret', $rnd, '', 'no');
        }
        return hash_hmac('sha256', $rnd, wp_salt('secure_auth') . wp_salt('logged_in'), true);
    }

    public static function key_for($context)
    {
        return hash_hmac('sha256', $context, self::site_key(), true);
    }

    /** AES-256-GCM: restituisce base64(iv|ct|tag). */
    public static function encrypt($plain, $key)
    {
        $iv = random_bytes(12);
        $tag = '';
        $ct = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($ct === false) {
            return false;
        }
        return base64_encode($iv . $ct . $tag);
    }

    public static function decrypt($b64, $key)
    {
        $raw = base64_decode((string) $b64, true);
        if ($raw === false || strlen($raw) < 29) {
            return false;
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, -16);
        $ct = substr($raw, 12, -16);
        return openssl_decrypt($ct, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    }

    /**
     * Sigilla un testo per l'utente con la sua chiave pubblica (RSA-OAEP + AES-256-GCM).
     * Solo il browser dell'utente, con la chiave privata sbloccata dalla password, può aprirlo.
     */
    public static function seal($plain, $pem)
    {
        $pub = openssl_pkey_get_public($pem);
        if (!$pub) {
            return false;
        }
        $k = random_bytes(32);
        $iv = random_bytes(12);
        $tag = '';
        $ct = openssl_encrypt($plain, 'aes-256-gcm', $k, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        $wrapped = '';
        if (!openssl_public_encrypt($k, $wrapped, $pub, OPENSSL_PKCS1_OAEP_PADDING)) {
            return false;
        }
        return wp_json_encode([
            'v' => 1,
            'w' => base64_encode($wrapped),
            'iv' => base64_encode($iv),
            'ct' => base64_encode($ct . $tag),
        ]);
    }

    public static function token($bytes = 32)
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    public static function hash($token)
    {
        return hash('sha256', (string) $token);
    }
}

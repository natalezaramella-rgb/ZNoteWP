<?php
if (!defined('ABSPATH')) {
    exit;
}

/** Lettore MIME minimo: intestazioni, testo, HTML e allegati di un messaggio grezzo. */
class ZNK_Mime
{
    public static function split($raw)
    {
        $raw = str_replace("\r\n", "\n", (string) $raw);
        $pos = strpos($raw, "\n\n");
        if ($pos === false) {
            return [$raw, ''];
        }
        return [substr($raw, 0, $pos), substr($raw, $pos + 2)];
    }

    /** Intestazioni come array nome-minuscolo => [valori]. */
    public static function headers($head)
    {
        $head = preg_replace("/\n[ \t]+/", ' ', $head);
        $out = [];
        foreach (explode("\n", $head) as $line) {
            $c = strpos($line, ':');
            if ($c === false) {
                continue;
            }
            $k = strtolower(trim(substr($line, 0, $c)));
            $out[$k][] = trim(substr($line, $c + 1));
        }
        return $out;
    }

    public static function h($headers, $name)
    {
        return isset($headers[$name][0]) ? $headers[$name][0] : '';
    }

    public static function decode_header($v)
    {
        if (strpos($v, '=?') === false) {
            return self::to_utf8($v, 'UTF-8');
        }
        if (function_exists('iconv_mime_decode')) {
            $d = @iconv_mime_decode($v, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
            if ($d !== false) {
                return $d;
            }
        }
        if (function_exists('mb_decode_mimeheader')) {
            return mb_decode_mimeheader($v);
        }
        return $v;
    }

    /** Parametro di un'intestazione (es. charset, boundary, filename). */
    public static function param($value, $name)
    {
        if (preg_match('/' . preg_quote($name, '/') . '\*?=\s*"([^"]*)"/i', $value, $m) || preg_match('/' . preg_quote($name, '/') . '\*?=\s*([^;\s]+)/i', $value, $m)) {
            $v = $m[1];
            if (preg_match("/^([A-Za-z0-9_-]+)''(.*)$/", $v, $mm)) {
                return self::to_utf8(rawurldecode($mm[2]), $mm[1]);
            }
            return self::decode_header($v);
        }
        return '';
    }

    public static function to_utf8($s, $charset)
    {
        $charset = strtoupper(trim((string) $charset)) ?: 'UTF-8';
        if ($charset === 'UTF-8' || $charset === 'US-ASCII') {
            return function_exists('mb_check_encoding') && !mb_check_encoding($s, 'UTF-8') ? utf8_encode_safe($s) : $s;
        }
        if (function_exists('mb_convert_encoding')) {
            $r = @mb_convert_encoding($s, 'UTF-8', $charset);
            if ($r !== false && $r !== '') {
                return $r;
            }
        }
        if (function_exists('iconv')) {
            $r = @iconv($charset, 'UTF-8//IGNORE', $s);
            if ($r !== false) {
                return $r;
            }
        }
        return $s;
    }

    public static function decode_body($body, $enc)
    {
        $enc = strtolower(trim($enc));
        if ($enc === 'base64') {
            return (string) base64_decode(preg_replace('/\s+/', '', $body));
        }
        if ($enc === 'quoted-printable') {
            return quoted_printable_decode(str_replace("\n", "\r\n", $body));
        }
        return $body;
    }

    /**
     * Analizza il messaggio.
     * @return array{headers:array,subject:string,from:string,from_name:string,date:string,text:string,html:string,attachments:array}
     */
    public static function parse($raw)
    {
        list($head, $body) = self::split($raw);
        $headers = self::headers($head);
        $msg = [
            'headers' => $headers,
            'subject' => trim(self::decode_header(self::h($headers, 'subject'))),
            'from' => '',
            'from_name' => '',
            'date' => self::h($headers, 'date'),
            'text' => '',
            'html' => '',
            'attachments' => [],
        ];
        $from = self::decode_header(self::h($headers, 'from'));
        if (preg_match('/<([^>]+)>/', $from, $m)) {
            $msg['from'] = strtolower(trim($m[1]));
            $msg['from_name'] = trim(trim(str_replace($m[0], '', $from)), "\" ");
        } else {
            $msg['from'] = strtolower(trim($from));
        }
        self::walk($headers, $body, $msg, 0);
        return $msg;
    }

    private static function walk($headers, $body, &$msg, $depth)
    {
        if ($depth > 8) {
            return;
        }
        $ct = self::h($headers, 'content-type') ?: 'text/plain; charset=us-ascii';
        $type = strtolower(trim(explode(';', $ct)[0]));
        $disp = self::h($headers, 'content-disposition');
        $enc = self::h($headers, 'content-transfer-encoding');
        if (strpos($type, 'multipart/') === 0) {
            $b = self::param($ct, 'boundary');
            if ($b === '') {
                return;
            }
            $parts = explode("\n--" . $b, "\n" . $body);
            array_shift($parts);
            foreach ($parts as $p) {
                if (strpos($p, '--') === 0) {
                    break;
                }
                $p = preg_replace('/^[^\n]*\n/', '', $p, 1);
                list($ph, $pb) = self::split($p);
                self::walk(self::headers($ph), $pb, $msg, $depth + 1);
            }
            return;
        }
        if ($type === 'message/rfc822' && stripos($disp, 'attachment') === false) {
            list($ih, $ib) = self::split(self::decode_body($body, $enc));
            $inner = self::headers($ih);
            $sub = self::decode_header(self::h($inner, 'subject'));
            $fr = self::decode_header(self::h($inner, 'from'));
            $msg['text'] .= "\n\n---------- Messaggio inoltrato ----------\nDa: $fr\nOggetto: $sub\n\n";
            self::walk($inner, $ib, $msg, $depth + 1);
            return;
        }
        $name = self::param($disp, 'filename') ?: self::param($ct, 'name');
        $is_att = stripos($disp, 'attachment') === 0 || ($name !== '' && strpos($type, 'text/') !== 0);
        $data = self::decode_body($body, $enc);
        if ($is_att || ($name !== '' && stripos($disp, 'inline') === 0 && strpos($type, 'image/') === 0)) {
            $msg['attachments'][] = ['name' => $name ?: 'allegato', 'type' => $type, 'size' => strlen($data), 'data' => $data, 'cid' => trim(self::h($headers, 'content-id'), '<> ')];
            return;
        }
        if ($type === 'text/plain') {
            $msg['text'] .= self::to_utf8($data, self::param($ct, 'charset'));
        } elseif ($type === 'text/html') {
            $msg['html'] .= self::to_utf8($data, self::param($ct, 'charset'));
        }
    }

    /** Indirizzi destinatari utili per trovare il "+codice". */
    public static function recipients($headers)
    {
        $out = [];
        foreach (['delivered-to', 'x-original-to', 'envelope-to', 'x-forwarded-to', 'to', 'cc'] as $h) {
            if (empty($headers[$h])) {
                continue;
            }
            foreach ($headers[$h] as $v) {
                if (preg_match_all('/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+/', $v, $m)) {
                    foreach ($m[0] as $a) {
                        $out[] = strtolower($a);
                    }
                }
            }
        }
        return array_values(array_unique($out));
    }

    /**
     * Verifica SPF/DKIM/DMARC dalle intestazioni Authentication-Results del server ricevente.
     * Accetta: dmarc=pass, oppure dkim=pass con dominio allineato, oppure spf=pass con dominio allineato.
     */
    public static function authenticated($headers, $from)
    {
        $dom = strtolower(substr(strrchr($from, '@') ?: '', 1));
        if (!$dom) {
            return false;
        }
        $aligned = function ($d) use ($dom) {
            $d = strtolower(trim($d, " .;\t"));
            return $d !== '' && ($d === $dom || substr($dom, -strlen('.' . $d)) === '.' . $d || substr($d, -strlen('.' . $dom)) === '.' . $dom);
        };
        $all = array_merge($headers['authentication-results'] ?? [], $headers['arc-authentication-results'] ?? []);
        foreach ($all as $ar) {
            $ar = strtolower($ar);
            if (preg_match('/dmarc=pass/', $ar)) {
                if (!preg_match('/header\.from=([^\s;]+)/', $ar, $m) || $aligned($m[1])) {
                    return true;
                }
            }
            if (preg_match_all('/dkim=pass[^;]*?header\.(?:d|i)=@?([^\s;]+)/', $ar, $m)) {
                foreach ($m[1] as $d) {
                    if ($aligned(substr(strrchr('@' . $d, '@'), 1))) {
                        return true;
                    }
                }
            }
            if (preg_match('/spf=pass[^;]*?smtp\.mailfrom=([^\s;]+)/', $ar, $m)) {
                $d = strpos($m[1], '@') !== false ? substr(strrchr($m[1], '@'), 1) : $m[1];
                if ($aligned($d)) {
                    return true;
                }
            }
        }
        return false;
    }
}

if (!function_exists('utf8_encode_safe')) {
    function utf8_encode_safe($s)
    {
        if (function_exists('mb_convert_encoding')) {
            return mb_convert_encoding($s, 'UTF-8', 'ISO-8859-1');
        }
        return $s;
    }
}

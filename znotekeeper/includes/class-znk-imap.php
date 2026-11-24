<?php
if (!defined('ABSPATH')) {
    exit;
}

/** Client IMAP minimo su socket (non richiede l'estensione php-imap). */
class ZNK_Imap
{
    private $s;
    private $n = 0;
    public $error = '';

    public function connect($host, $port, $secure, $timeout = 20)
    {
        $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'SNI_enabled' => true, 'peer_name' => $host]]);
        $proto = $secure === 'ssl' ? 'ssl://' : 'tcp://';
        $this->s = @stream_socket_client($proto . $host . ':' . (int) $port, $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $ctx);
        if (!$this->s) {
            $this->error = "Connessione a $host:$port non riuscita: $errstr";
            return false;
        }
        stream_set_timeout($this->s, $timeout);
        $greet = fgets($this->s);
        if ($greet === false || strpos($greet, '* OK') !== 0) {
            $this->error = 'Risposta inattesa dal server IMAP.';
            return false;
        }
        if ($secure === 'tls') {
            $r = $this->cmd('STARTTLS');
            if (!$r['ok'] || !stream_socket_enable_crypto($this->s, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                $this->error = 'STARTTLS non riuscito.';
                return false;
            }
        }
        return true;
    }

    private static function q($s)
    {
        return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $s) . '"';
    }

    /** Esegue un comando e raccoglie le righe (con i letterali {n}). */
    public function cmd($c)
    {
        $tag = 'Z' . (++$this->n);
        fwrite($this->s, "$tag $c\r\n");
        $lines = [];
        while (true) {
            $line = fgets($this->s);
            if ($line === false) {
                return ['ok' => false, 'lines' => $lines, 'status' => 'EOF'];
            }
            if (preg_match('/\{(\d+)\}\r\n$/', $line, $m)) {
                $len = (int) $m[1];
                $buf = '';
                while (strlen($buf) < $len) {
                    $chunk = fread($this->s, min(65536, $len - strlen($buf)));
                    if ($chunk === false || $chunk === '') {
                        break;
                    }
                    $buf .= $chunk;
                }
                $lines[] = ['literal' => $buf, 'line' => $line];
                continue;
            }
            if (strpos($line, $tag . ' ') === 0) {
                $ok = strpos($line, "$tag OK") === 0;
                return ['ok' => $ok, 'lines' => $lines, 'status' => trim($line)];
            }
            $lines[] = $line;
        }
    }

    public function login($user, $pass)
    {
        $r = $this->cmd('LOGIN ' . self::q($user) . ' ' . self::q($pass));
        if (!$r['ok']) {
            $this->error = 'Accesso IMAP rifiutato.';
        }
        return $r['ok'];
    }

    public function select($folder)
    {
        $r = $this->cmd('SELECT ' . self::q($folder));
        if (!$r['ok']) {
            $this->error = 'Cartella non trovata: ' . $folder;
        }
        return $r['ok'];
    }

    /** UID di tutti i messaggi presenti. */
    public function uids()
    {
        $r = $this->cmd('UID SEARCH ALL');
        foreach ($r['lines'] as $l) {
            if (is_string($l) && strpos($l, '* SEARCH') === 0) {
                return array_filter(array_map('intval', preg_split('/\s+/', trim(substr($l, 8)))));
            }
        }
        return [];
    }

    public function fetch($uid)
    {
        $r = $this->cmd('UID FETCH ' . (int) $uid . ' (RFC822.SIZE BODY.PEEK[])');
        foreach ($r['lines'] as $l) {
            if (is_array($l)) {
                return $l['literal'];
            }
        }
        return null;
    }

    public function delete($uid)
    {
        $this->cmd('UID STORE ' . (int) $uid . ' +FLAGS.SILENT (\\Deleted)');
    }

    public function expunge()
    {
        $this->cmd('EXPUNGE');
    }

    public function logout()
    {
        if ($this->s) {
            @$this->cmd('LOGOUT');
            @fclose($this->s);
            $this->s = null;
        }
    }
}

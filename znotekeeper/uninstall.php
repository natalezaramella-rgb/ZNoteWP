<?php
// Rimozione del plugin da WordPress: cancella tabelle e opzioni.
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
require_once __DIR__ . '/includes/class-znk-db.php';
ZNK_DB::drop_all();
require_once __DIR__ . '/includes/class-znk-access.php';
ZNK_Access::drop();
require_once __DIR__ . '/includes/class-znk-vault.php';
ZNK_Vault::drop();
foreach (['znk_db_version', 'znk_site_secret', 'znk_mail', 'znk_mail_auth_check', 'znk_mail_rate', 'znk_mail_last_check', 'znk_mail_log', 'znk_vapid', 'znk_rewrite_version'] as $o) {
    delete_option($o);
}

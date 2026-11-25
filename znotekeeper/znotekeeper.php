<?php
/**
 * Plugin Name:       ZNoteKeeper
 * Description:       Taccuino e attività riservati per gli utenti abilitati: dati cifrati nel browser, app installabile (PWA) su telefono e PC, email → nota.
 * Version:           1.2.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Zaramella
 * License:           GPL-2.0-or-later
 * Text Domain:       znotekeeper
 */

if (!defined('ABSPATH')) {
    exit;
}

define('ZNK_VERSION', '1.2.1');
define('ZNK_DB_VERSION', '2');
define('ZNK_FILE', __FILE__);
define('ZNK_DIR', plugin_dir_path(__FILE__));
define('ZNK_URL', plugin_dir_url(__FILE__));
define('ZNK_SLUG', 'znotekeeper');

require_once ZNK_DIR . 'includes/class-znk-db.php';
require_once ZNK_DIR . 'includes/class-znk-secret.php';
require_once ZNK_DIR . 'includes/class-znk-users.php';
require_once ZNK_DIR . 'includes/class-znk-auth.php';
require_once ZNK_DIR . 'includes/class-znk-rest.php';
require_once ZNK_DIR . 'includes/class-znk-app.php';
require_once ZNK_DIR . 'includes/class-znk-admin.php';
require_once ZNK_DIR . 'includes/class-znk-mime.php';
require_once ZNK_DIR . 'includes/class-znk-imap.php';
require_once ZNK_DIR . 'includes/class-znk-mail.php';
require_once ZNK_DIR . 'includes/class-znk-push.php';
require_once ZNK_DIR . 'includes/class-znk-cron.php';
require_once ZNK_DIR . 'includes/class-znk-access.php';

register_activation_hook(__FILE__, function () {
    ZNK_DB::install();
    ZNK_Push::ensure_keys();
    ZNK_App::add_rewrites();
    ZNK_Access::install();
    ZNK_Access::add_rewrites();
    flush_rewrite_rules();
    ZNK_Cron::schedule();
});

register_deactivation_hook(__FILE__, function () {
    ZNK_Cron::unschedule();
    flush_rewrite_rules();
});

add_action('plugins_loaded', function () {
    if (get_option('znk_db_version') !== ZNK_DB_VERSION) {
        ZNK_DB::install();
    }
    ZNK_Users::init();
    ZNK_REST::init();
    ZNK_App::init();
    ZNK_Admin::init();
    ZNK_Cron::init();
    ZNK_Access::init();
});

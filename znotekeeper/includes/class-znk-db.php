<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Schema del database. Le colonne in chiaro sono solo quelle che servono
 * a ordinare, sincronizzare e mandare i promemoria: tutto il contenuto sta
 * nella colonna `data`, cifrata nel browser.
 */
class ZNK_DB
{
    public static function t($name)
    {
        global $wpdb;
        return $wpdb->prefix . 'znk_' . $name;
    }

    public static function install()
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $c = $wpdb->get_charset_collate();

        $users = self::t('users');
        $devices = self::t('devices');
        $items = self::t('items');
        $versions = self::t('versions');
        $inbox = self::t('inbox');

        dbDelta("CREATE TABLE $users (
  user_id BIGINT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  enabled_at DATETIME NULL,
  vault LONGTEXT NULL,
  pw_auth VARCHAR(255) NULL,
  rc_auth VARCHAR(255) NULL,
  mk_auth VARCHAR(255) NULL,
  fails INT NOT NULL DEFAULT 0,
  next_try_at DATETIME NULL,
  seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  purge_floor BIGINT UNSIGNED NOT NULL DEFAULT 0,
  inbox_token VARCHAR(40) NULL,
  sender_salt VARCHAR(64) NULL,
  senders LONGTEXT NULL,
  mail_hour_start DATETIME NULL,
  mail_hour_count INT NOT NULL DEFAULT 0,
  er_sealed TEXT NULL,
  er_wrapped TEXT NULL,
  er_email VARCHAR(190) NULL,
  er_token_hash CHAR(64) NULL,
  er_token_exp DATETIME NULL,
  er_ready_at DATETIME NULL,
  reset_ticket_hash CHAR(64) NULL,
  reset_ticket_exp DATETIME NULL,
  rc_created_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY  (user_id),
  KEY inbox_token (inbox_token)
) $c;");

        dbDelta("CREATE TABLE $devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  name VARCHAR(190) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  last_seen DATETIME NOT NULL,
  session_hash CHAR(64) NULL,
  session_exp DATETIME NULL,
  pin_hash VARCHAR(255) NULL,
  pin_pepper VARCHAR(64) NULL,
  pin_fails INT NOT NULL DEFAULT 0,
  rem_hash VARCHAR(255) NULL,
  rem_pepper VARCHAR(64) NULL,
  push_endpoint TEXT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY token_hash (token_hash),
  KEY user_id (user_id)
) $c;");

        dbDelta("CREATE TABLE $items (
  user_id BIGINT UNSIGNED NOT NULL,
  id VARCHAR(40) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  parent_id VARCHAR(40) NULL,
  sort DOUBLE NOT NULL DEFAULT 0,
  due_at DATETIME NULL,
  remind_at DATETIME NULL,
  reminded TINYINT(1) NOT NULL DEFAULT 0,
  completed TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  purged TINYINT(1) NOT NULL DEFAULT 0,
  rev INT UNSIGNED NOT NULL DEFAULT 1,
  seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  size INT UNSIGNED NOT NULL DEFAULT 0,
  data LONGTEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY  (user_id,id),
  KEY user_seq (user_id,seq),
  KEY remind (remind_at,reminded)
) $c;");

        dbDelta("CREATE TABLE $versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  item_id VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL,
  data LONGTEXT NOT NULL,
  PRIMARY KEY  (id),
  KEY item (user_id,item_id)
) $c;");

        dbDelta("CREATE TABLE $inbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  received_at DATETIME NOT NULL,
  size INT UNSIGNED NOT NULL DEFAULT 0,
  sealed LONGTEXT NOT NULL,
  PRIMARY KEY  (id),
  KEY user_id (user_id)
) $c;");

        update_option('znk_db_version', ZNK_DB_VERSION);
    }

    public static function now()
    {
        return gmdate('Y-m-d H:i:s');
    }

    public static function drop_all()
    {
        global $wpdb;
        foreach (['users', 'devices', 'items', 'versions', 'inbox'] as $n) {
            $wpdb->query('DROP TABLE IF EXISTS ' . self::t($n));
        }
    }
}

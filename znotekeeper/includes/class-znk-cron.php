<?php
if (!defined('ABSPATH')) {
    exit;
}

class ZNK_Cron
{
    public static function init()
    {
        add_filter('cron_schedules', function ($s) {
            $s['znk_five'] = ['interval' => 300, 'display' => 'Ogni 5 minuti (ZNoteKeeper)'];
            return $s;
        });
        add_action('znk_tick', [__CLASS__, 'tick']);
        add_action('znk_daily', [__CLASS__, 'daily']);
        if (!wp_next_scheduled('znk_tick') || !wp_next_scheduled('znk_daily')) {
            add_action('init', [__CLASS__, 'schedule']);
        }
    }

    public static function schedule()
    {
        if (!wp_next_scheduled('znk_tick')) {
            wp_schedule_event(time() + 60, 'znk_five', 'znk_tick');
        }
        if (!wp_next_scheduled('znk_daily')) {
            wp_schedule_event(time() + 3600, 'daily', 'znk_daily');
        }
    }

    public static function unschedule()
    {
        wp_clear_scheduled_hook('znk_tick');
        wp_clear_scheduled_hook('znk_daily');
    }

    public static function tick()
    {
        $c = ZNK_Mail::settings();
        if ($c['mode'] === 'imap') {
            ZNK_Mail::poll();
        }
        ZNK_Push::run();
    }

    /** Cestino: eliminazione definitiva dopo 30 giorni; pulizia delle tracce dopo 90. */
    public static function daily()
    {
        global $wpdb;
        $it = ZNK_DB::t('items');
        $old = gmdate('Y-m-d H:i:s', time() - 30 * DAY_IN_SECONDS);
        $rows = $wpdb->get_results($wpdb->prepare("SELECT user_id, id FROM $it WHERE purged = 0 AND deleted_at IS NOT NULL AND deleted_at < %s LIMIT 2000", $old));
        foreach ($rows as $r) {
            ZNK_REST::purge((int) $r->user_id, $r->id);
        }
        $older = gmdate('Y-m-d H:i:s', time() - 90 * DAY_IN_SECONDS);
        $tomb = $wpdb->get_results($wpdb->prepare("SELECT user_id, MAX(seq) AS s FROM $it WHERE purged = 1 AND updated_at < %s GROUP BY user_id", $older));
        foreach ($tomb as $t) {
            $wpdb->query($wpdb->prepare("DELETE FROM $it WHERE user_id = %d AND purged = 1 AND seq <= %d", $t->user_id, $t->s));
            $wpdb->query($wpdb->prepare('UPDATE ' . ZNK_DB::t('users') . ' SET purge_floor = GREATEST(purge_floor, %d) WHERE user_id = %d', $t->s, $t->user_id));
        }
        $wpdb->query($wpdb->prepare('DELETE FROM ' . ZNK_DB::t('devices') . ' WHERE last_seen < %s', gmdate('Y-m-d H:i:s', time() - ZNK_Auth::DEVICE_TTL)));
    }
}

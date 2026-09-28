<?php
/**
 * Runs when the plugin is deleted from the Plugins screen. Removes all plugin options.
 *
 * @package SignalEngine
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Delete this plugin's options for the current site.
 */
function ose_uninstall_delete_options() {
	delete_option( 'ose_settings' );
}

if ( is_multisite() ) {
	$ose_site_ids = get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	);
	foreach ( $ose_site_ids as $ose_site_id ) {
		switch_to_blog( (int) $ose_site_id );
		ose_uninstall_delete_options();
		restore_current_blog();
	}
} else {
	ose_uninstall_delete_options();
}

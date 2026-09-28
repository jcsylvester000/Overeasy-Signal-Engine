<?php
/**
 * Plugin Name:       Signal Engine
 * Description:       Adds the Signal Engine website tag to your site to capture ad click IDs and lead form submissions.
 * Version:           1.0.0
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            Signal Engine
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       signal-engine
 *
 * @package SignalEngine
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'OSE_VERSION', '1.0.0' );
define( 'OSE_OPTION', 'ose_settings' );
define( 'OSE_OPTION_GROUP', 'ose_settings_group' );
define( 'OSE_PAGE_SLUG', 'ose-signal-engine' );
define( 'OSE_SCRIPT_HANDLE', 'ose-tag' );
define( 'OSE_SITE_KEY_REGEX', '/^site_[a-z0-9]{6,32}$/' );
define( 'OSE_HOST_REGEX', '/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$/' );

/**
 * Default option values.
 *
 * @return array
 */
function ose_defaults() {
	return array(
		'tag_host'       => '',
		'site_key'       => '',
		'exclude_admins' => 1,
	);
}

/**
 * Current settings merged with defaults.
 *
 * @return array
 */
function ose_get_settings() {
	$saved = get_option( OSE_OPTION, array() );
	if ( ! is_array( $saved ) ) {
		$saved = array();
	}
	return array_merge( ose_defaults(), $saved );
}

/**
 * Normalise a tag host: strip scheme, path, whitespace; lower-case.
 *
 * @param string $value Raw input.
 * @return string
 */
function ose_normalize_host( $value ) {
	$host = strtolower( trim( sanitize_text_field( (string) $value ) ) );
	$host = preg_replace( '#^[a-z][a-z0-9+.-]*://#', '', $host );
	$host = preg_replace( '#[/?\#].*$#', '', $host );
	return (string) $host;
}

/* -------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------- */

/**
 * Register the setting, section and fields.
 */
function ose_register_settings() {
	register_setting(
		OSE_OPTION_GROUP,
		OSE_OPTION,
		array(
			'type'              => 'array',
			'sanitize_callback' => 'ose_sanitize_settings',
			'default'           => ose_defaults(),
			'show_in_rest'      => false,
		)
	);

	add_settings_section(
		'ose_main',
		__( 'Tag settings', 'signal-engine' ),
		'ose_render_section',
		OSE_PAGE_SLUG
	);

	add_settings_field(
		'ose_tag_host',
		__( 'Tag host', 'signal-engine' ),
		'ose_render_field_host',
		OSE_PAGE_SLUG,
		'ose_main',
		array( 'label_for' => 'ose_tag_host' )
	);

	add_settings_field(
		'ose_site_key',
		__( 'Site key', 'signal-engine' ),
		'ose_render_field_site_key',
		OSE_PAGE_SLUG,
		'ose_main',
		array( 'label_for' => 'ose_site_key' )
	);

	add_settings_field(
		'ose_exclude_admins',
		__( 'Exclude administrators', 'signal-engine' ),
		'ose_render_field_exclude',
		OSE_PAGE_SLUG,
		'ose_main',
		array( 'label_for' => 'ose_exclude_admins' )
	);
}
add_action( 'admin_init', 'ose_register_settings' );

/**
 * Sanitize and validate submitted settings. Invalid values keep the previous value.
 *
 * @param mixed $input Raw submitted value.
 * @return array
 */
function ose_sanitize_settings( $input ) {
	$current = ose_get_settings();
	$input   = is_array( $input ) ? $input : array();
	$output  = $current;

	// Tag host.
	$host = isset( $input['tag_host'] ) ? ose_normalize_host( wp_unslash( $input['tag_host'] ) ) : '';
	if ( '' === $host ) {
		$output['tag_host'] = '';
	} elseif ( preg_match( OSE_HOST_REGEX, $host ) ) {
		$output['tag_host'] = $host;
	} else {
		add_settings_error(
			OSE_OPTION,
			'ose_invalid_host',
			__( 'Tag host must be a host name such as t.agency.com (no https:// and no path). The previous value was kept.', 'signal-engine' )
		);
	}

	// Site key.
	$key = isset( $input['site_key'] ) ? trim( sanitize_text_field( wp_unslash( $input['site_key'] ) ) ) : '';
	if ( '' === $key ) {
		$output['site_key'] = '';
	} elseif ( preg_match( OSE_SITE_KEY_REGEX, $key ) ) {
		$output['site_key'] = $key;
	} else {
		add_settings_error(
			OSE_OPTION,
			'ose_invalid_site_key',
			__( 'Site key must be "site_" followed by 6-32 lowercase letters or digits. The previous value was kept.', 'signal-engine' )
		);
	}

	$output['exclude_admins'] = empty( $input['exclude_admins'] ) ? 0 : 1;

	return array(
		'tag_host'       => (string) $output['tag_host'],
		'site_key'       => (string) $output['site_key'],
		'exclude_admins' => (int) $output['exclude_admins'],
	);
}

/**
 * Add the Settings → Signal Engine page.
 */
function ose_add_settings_page() {
	add_options_page(
		__( 'Signal Engine', 'signal-engine' ),
		__( 'Signal Engine', 'signal-engine' ),
		'manage_options',
		OSE_PAGE_SLUG,
		'ose_render_settings_page'
	);
}
add_action( 'admin_menu', 'ose_add_settings_page' );

/**
 * Section intro.
 */
function ose_render_section() {
	echo '<p>' . esc_html__( 'Enter the tag host and site key from your Signal Engine workspace. The tag loads asynchronously in the page head and binds your lead forms automatically.', 'signal-engine' ) . '</p>';
}

/**
 * Tag host field.
 */
function ose_render_field_host() {
	$s = ose_get_settings();
	printf(
		'<input type="text" id="ose_tag_host" name="%1$s[tag_host]" value="%2$s" class="regular-text" placeholder="t.agency.com" autocomplete="off" spellcheck="false" />',
		esc_attr( OSE_OPTION ),
		esc_attr( $s['tag_host'] )
	);
	echo '<p class="description">' . esc_html__( 'Host name only, for example t.agency.com.', 'signal-engine' ) . '</p>';
}

/**
 * Site key field.
 */
function ose_render_field_site_key() {
	$s = ose_get_settings();
	printf(
		'<input type="text" id="ose_site_key" name="%1$s[site_key]" value="%2$s" class="regular-text code" placeholder="site_abc123" pattern="^site_[a-z0-9]{6,32}$" autocomplete="off" spellcheck="false" />',
		esc_attr( OSE_OPTION ),
		esc_attr( $s['site_key'] )
	);
	echo '<p class="description">' . esc_html__( 'Format: site_ followed by 6-32 lowercase letters or digits.', 'signal-engine' ) . '</p>';
}

/**
 * Exclude administrators field.
 */
function ose_render_field_exclude() {
	$s = ose_get_settings();
	printf(
		'<label><input type="checkbox" id="ose_exclude_admins" name="%1$s[exclude_admins]" value="1" %2$s /> %3$s</label>',
		esc_attr( OSE_OPTION ),
		checked( 1, (int) $s['exclude_admins'], false ),
		esc_html__( 'Do not load the tag for logged-in administrators', 'signal-engine' )
	);
}

/**
 * Render the settings page. Nonce and capability checks are handled by the Settings API
 * (settings_fields() + options.php) and by the manage_options capability on the page.
 */
function ose_render_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	?>
	<div class="wrap">
		<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
		<?php settings_errors( OSE_OPTION ); ?>
		<form action="options.php" method="post">
			<?php
			settings_fields( OSE_OPTION_GROUP );
			do_settings_sections( OSE_PAGE_SLUG );
			submit_button();
			?>
		</form>
	</div>
	<?php
}

/**
 * The options.php handler checks this capability for the option group.
 *
 * @return string
 */
function ose_option_page_capability() {
	return 'manage_options';
}
add_filter( 'option_page_capability_' . OSE_OPTION_GROUP, 'ose_option_page_capability' );

/**
 * "Settings" link on the Plugins screen.
 *
 * @param array $links Existing links.
 * @return array
 */
function ose_plugin_action_links( $links ) {
	$url = admin_url( 'options-general.php?page=' . OSE_PAGE_SLUG );
	array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'signal-engine' ) . '</a>' );
	return $links;
}
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'ose_plugin_action_links' );

/* -------------------------------------------------------------------------
 * Front end
 * ---------------------------------------------------------------------- */

/**
 * Whether the tag should load on this request.
 *
 * @param array $s Settings.
 * @return bool
 */
function ose_should_load( array $s ) {
	if ( '' === $s['tag_host'] || '' === $s['site_key'] ) {
		return false;
	}
	if ( ! preg_match( OSE_HOST_REGEX, $s['tag_host'] ) || ! preg_match( OSE_SITE_KEY_REGEX, $s['site_key'] ) ) {
		return false;
	}
	if ( is_admin() || is_feed() || is_robots() || is_customize_preview() ) {
		return false;
	}
	if ( ! empty( $s['exclude_admins'] ) && is_user_logged_in() && current_user_can( 'manage_options' ) ) {
		return false;
	}
	return (bool) apply_filters( 'ose_should_load', true, $s );
}

/**
 * Enqueue the tag in <head> with the async loading strategy (WP 6.3+).
 */
function ose_enqueue_tag() {
	$s = ose_get_settings();
	if ( ! ose_should_load( $s ) ) {
		return;
	}
	wp_enqueue_script(
		OSE_SCRIPT_HANDLE,
		esc_url_raw( 'https://' . $s['tag_host'] . '/ose.js' ),
		array(),
		null, // No ?ver= query string; the tag host controls caching.
		array(
			'strategy'  => 'async',
			'in_footer' => false,
		)
	);
}
add_action( 'wp_enqueue_scripts', 'ose_enqueue_tag' );

/**
 * Add the data-site attribute to the tag's <script> element.
 *
 * @param string $tag    Script HTML.
 * @param string $handle Script handle.
 * @param string $src    Script source URL (unused; WordPress already escaped it).
 * @return string
 */
function ose_script_loader_tag( $tag, $handle, $src ) {
	unset( $src );
	if ( OSE_SCRIPT_HANDLE !== $handle || false !== strpos( $tag, 'data-site=' ) ) {
		return $tag;
	}
	$s = ose_get_settings();
	if ( ! preg_match( OSE_SITE_KEY_REGEX, $s['site_key'] ) ) {
		return $tag;
	}
	$attr = ' data-site="' . esc_attr( $s['site_key'] ) . '"';
	$out  = preg_replace( '/<script\b/i', '<script' . $attr, $tag, 1 );
	return is_string( $out ) ? $out : $tag;
}
add_filter( 'script_loader_tag', 'ose_script_loader_tag', 10, 3 );

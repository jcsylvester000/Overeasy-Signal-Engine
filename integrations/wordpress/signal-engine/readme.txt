=== Signal Engine ===
Contributors: signalengine
Tags: attribution, lead tracking, gclid, conversions, utm
Requires at least: 6.3
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds the Signal Engine website tag, which captures ad click IDs and UTMs and links them to your lead form submissions.

== Description ==

Signal Engine connects your website leads to the ad clicks that produced them. The plugin adds a small, asynchronous tag to the `<head>` of every front-end page. The tag:

* stores ad click IDs (gclid, gbraid, wbraid, msclkid, fbclid), UTM parameters and click time as first and last touch;
* binds your lead forms automatically. It works with Contact Form 7, WPForms, Gravity Forms and plain HTML forms, with no extra setup;
* never reads password, payment card or government ID fields, and skips login and sign-up forms;
* respects Google Consent Mode signals (`ad_user_data`, `ad_personalization`) found in the dataLayer.

Optional attributes let you control forms in your theme or form builder:

* `data-ose-ignore` on a form turns off capture for that form.
* `data-ose-form="quote-request"` names the form in reports.
* `data-ose-field="budget"` sets the key for a field.

The plugin makes no external HTTP requests from PHP. The tag loads in the visitor's browser from the tag host you configure.

== Installation ==

1. Upload the `signal-engine` folder to `/wp-content/plugins/`, or install the ZIP from Plugins → Add New → Upload Plugin.
2. Activate the plugin.
3. Go to **Settings → Signal Engine**.
4. Enter the **Tag host** (for example `t.agency.com`) and **Site key** (for example `site_abc123`) from your Signal Engine workspace.
5. Save. Open your site in a private window and run `ose.debug()` in the browser console to confirm the tag is running.

If you already load the tag through Google Tag Manager, don't use this plugin as well. Use one method only.

== Frequently Asked Questions ==

= Does the tag slow down my site? =

No. The tag loads with the `async` strategy, so it never blocks rendering, and it has no dependencies.

= Why don't I see the tag when I'm logged in? =

By default the tag is not loaded for logged-in administrators, so your own visits are not tracked. You can turn this off under Settings → Signal Engine.

= Can I turn the tag off on specific pages? =

Yes. Use the `ose_should_load` filter: `add_filter( 'ose_should_load', function ( $load ) { return is_page( 'thank-you' ) ? false : $load; } );`

== Privacy ==

This plugin loads a tag that collects data in your visitors' browsers. The tag collects ad click identifiers, UTM parameters, landing page URL (without query string), referrer, and the contents of lead forms that visitors submit (for example name, email, phone and form answers). It stores a random visitor ID in a first-party cookie and in localStorage. This data is sent to the Signal Engine tag host you configure. Signal Engine may use it to send conversion signals to advertising platforms such as Google Ads and Microsoft Advertising, with email and phone numbers hashed where the platform requires it.

**As the site owner, you are responsible for disclosing this data collection and sharing with advertising platforms in your privacy policy.** Where required, for example under the GDPR, ePrivacy rules or US state privacy laws, you must also get visitor consent before the tag runs. Use a consent management platform that sets Google Consent Mode. The tag forwards `ad_user_data` and `ad_personalization` consent states with every event.

The plugin itself stores only its settings (tag host, site key, admin exclusion) in the WordPress options table. It removes them when you delete the plugin.

== Changelog ==

= 1.0.0 =
* Initial release: settings page, asynchronous tag in the head with a data-site attribute, option to exclude administrators.

== Upgrade Notice ==

= 1.0.0 =
Initial release.

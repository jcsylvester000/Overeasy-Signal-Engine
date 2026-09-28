# Signal Engine integrations

These packages install the Signal Engine website tag without hand-editing site HTML. They
produce the same result as the manual snippet:

```html
<script async src="https://{TAG_HOST}/ose.js" data-site="{SITE_KEY}"></script>
```

Use **one** install method per site. If you load the tag twice, the second copy exits because `window.ose.version` is already set, but it still wastes a request.

## `gtm-template/` - Google Tag Manager Custom Template (web)

- `template.tpl`: Community Template Gallery format. Fields: Tag host, Site key (`^site_[a-z0-9]{6,32}$`), optional Consent Mode mapping.
- `metadata.yaml`, `README.md`: Gallery metadata, import steps, and how to submit to the Gallery.
- `TAG_PATCH.md`: **required tag change.** GTM's `injectScript` cannot set `data-site`, so
  the template sets `window.oseConfig = { site }` and injects `ose.js?site=...`. `src/tag/ose.ts`
  must fall back to `window.oseConfig.site` and locate its script via `script[src*='/ose.js']`.
  Until that patch ships, GTM installs send events with an empty site key.

## `wordpress/signal-engine/` - WordPress plugin

- `signal-engine.php`: adds a **Settings → Signal Engine** page (capability `manage_options`; the Settings API handles the nonce). Tag host and site key are sanitized and validated in the `register_setting` sanitize callback; invalid input keeps the previous value and shows an error. The plugin enqueues the tag in `<head>` with the `async` strategy (WP 6.3+) and adds `data-site` through `script_loader_tag`. It can skip the tag for logged-in admins (on by default). A `ose_should_load` filter lets you skip the tag on chosen pages. PHP makes no external requests.
- `uninstall.php`: deletes the `ose_settings` option, on every site in a multisite network.
- `readme.txt`: WordPress.org format. It includes a Privacy section stating that the site owner must disclose data sharing with ad platforms.
- Distribution: zip the `signal-engine/` folder and upload it via Plugins → Add New → Upload Plugin.

Form handling for Contact Form 7, WPForms and Gravity Forms needs no plugin hooks. The tag binds forms automatically, and you can control this with `data-ose-ignore`, `data-ose-form` and `data-ose-field`.

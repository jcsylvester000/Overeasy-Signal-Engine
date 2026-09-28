# Signal Engine Tag - Google Tag Manager template

A web Custom Template that loads the Signal Engine website tag (`ose.js`) through GTM.

| File | Purpose |
|---|---|
| `template.tpl` | The template in Community Template Gallery format |
| `metadata.yaml` | Gallery metadata (homepage, documentation, version history) |
| `TAG_PATCH.md` | Required tag change so GTM-loaded installs carry the site key |

> **Before you use this template:** the tag must read `window.oseConfig.site` when the
> `data-site` attribute is absent. See `TAG_PATCH.md`. Without that patch the tag loads,
> but events are sent with an empty site key.

## Fields

| Field | Required | Example | Notes |
|---|---|---|---|
| Tag host | yes | `t.agency.com` | Host only. A pasted `https://` or trailing `/` is stripped. |
| Site key | yes | `site_abc123` | Must match `^site_[a-z0-9]{6,32}$` |
| Pass Google Consent Mode state | no | off | Reads GTM consent for `ad_user_data` / `ad_personalization` and forwards it with `ose.consent()` |

## What the template does

1. Sets `window.oseConfig = { site: "<siteKey>" }`. `injectScript` cannot set `data-site`, so the key is passed as a global.
2. If consent mapping is on, forwards the consent state. It calls `ose.consent()` if the tag is already loaded. Otherwise it adds the call to the `ose.q` pre-load queue.
3. Injects `https://<tagHost>/ose.js?site=<siteKey>` (cached per URL, so it is injected only once per page).

## Permissions

- **Injects scripts:** `https://*/ose.js`. You can narrow this to your own host (for example `https://t.agency.com/ose.js`) in the template editor's Permissions tab.
- **Accesses global variables:** `oseConfig` (write), `ose` (read/write), `ose.q` (read/write), `ose.consent` (execute).
- **Accesses consent state:** `ad_user_data`, `ad_personalization` (read).
- **Logs to console:** debug mode only.

## Import into GTM

1. In GTM, open your container and go to **Templates**.
2. Under **Tag Templates**, click **New**.
3. Open the three-dot menu (top right) and choose **Import**. Select `template.tpl`.
4. Click **Save**. Optionally run the two tests on the **Tests** tab.
5. Go to **Tags → New → Tag Configuration** and pick **Signal Engine Tag**.
6. Enter the Tag host and Site key. Set the trigger to **Consent Initialization - All Pages**, or **All Pages** if you don't use a CMP.
7. Check it in **Preview** (run `ose.debug()` in the browser console), then **Submit / Publish**.

Forms are bound automatically. On the website you can mark forms with `data-ose-ignore` (skip),
`data-ose-form="name"` (label), and label fields with `data-ose-field="key"`.

## Submit to the Community Template Gallery

1. Create a **public GitHub repository** with these files at the repository root: `template.tpl`,
   `metadata.yaml`, `README.md` and a `LICENSE` (Apache 2.0 is required by the Gallery).
2. Replace the brand and repository placeholders in `metadata.yaml`. Also replace
   `brand_dummy` in `___INFO___` with your brand's GitHub-based id if you have one.
3. Commit, then put the **full commit SHA** into `metadata.yaml` under `versions`, with
   the newest version listed first. Commit again.
4. Read and agree to the Gallery Developer Terms of Service (see the header of `template.tpl`).
5. Submit the repository through Google's Community Template Gallery submission form (linked
   from the Gallery developer docs). Google indexes the repository and runs automated checks.
6. To publish an update, commit the new `template.tpl`, then add a new entry at the top of
   `versions` with its SHA and `changeNotes`. The Gallery picks it up automatically.

Keep user-facing strings white-label: use "Signal Engine" or the agency's own brand only.

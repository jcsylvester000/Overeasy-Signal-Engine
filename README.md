# Signal Engine

A white-label, multi-tenant web app that gives ad spend a feedback loop. It plugs into **any** client website and CRM:

1. **① Score every lead**: a versioned, tested scoring model gives each form lead an initial value and lead type the moment it arrives.
2. **② Follow it through the CRM**: CRM pipeline stages (GoHighLevel first, any CRM through the generic webhook/API) map to one standard ladder: Submitted → Qualified → Opportunity → Contract → Sold → Funded (+ Lost).
3. **⑤ Send better signals to Google & Microsoft**: a value engine turns each stage into a correctly ordered value. It uploads only the increase, applies floors and caps, and blocks anything outside the platforms' click window. Values go to the Google Data Manager API and Microsoft offline conversions.

Status: **pre-funding concept, staging only.** All connectors are fully coded but run in **dry run** until platform approvals land (Google OAuth verification + Ads API access, GHL Marketplace app, Microsoft developer token). In dry run, every payload is built, validated and logged, but nothing is sent.

Proprietary. All rights reserved.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 |
| Data | Supabase Postgres with row-level security on every tenant table |
| Auth | Supabase Auth (invite-only; email + password or magic link) |
| Secrets | Supabase Vault (OAuth tokens) · AES-256-GCM app key (raw PII, webhook secrets) |
| Jobs | Inngest (durable retries/backoff/crons). Without Inngest keys, jobs run in-process right after each response |
| Hosting | Netlify (staging) |

## Project map

```
supabase/migrations/        schema, RLS policies, Vault wrappers (single source of truth for the DB)
src/core/                   pure engines, no I/O: scoring, value ladder, stages, hashing, industry templates
src/connectors/             Google Data Manager, Microsoft offline conversions, GoHighLevel (client + Ed25519 verify)
src/server/                 intake, lifecycle, signals, delivery, CRM sync, webhooks, health, provisioning
src/inngest/                durable job definitions (same handlers as the inline runner)
src/tag/ose.ts              website tag → public/ose.js (built by scripts/build-tag.mjs, < 6 KB gz)
src/app/api/v1/             public API (also served at /v1/*): collect, leads, stage, webhooks
src/app/w/[ws]/             workspace dashboard: overview, leads, signals, scoring, stages, value, connections, sites, simulator, health, audit, settings
src/app/org/[org]/          organization console: client workspaces, users, white-label branding, partner orgs
```

## Tenancy and white-label

Organizations form a tree: **platform → partner agency → direct client**. Each organization owns **workspaces**, and one workspace is one client business. Roles are Owner, Admin, Manager, Analyst and Client viewer. A role granted on an organization also applies to its child organizations. Partner brand settings (name, logo, colours, domains) replace the platform's everywhere the partner's users and clients look. The platform's own name is never inherited. `PLATFORM_APP_NAME` is the neutral fallback.

## Local setup

1. Node 22+. `npm install`
2. Create a Supabase project. In the **SQL editor**, run every file in `supabase/migrations/` **in filename order** (`20260928000000_init.sql`, then `20260929000000_compliance_and_ops.sql`), or use `supabase link` and then `supabase db push`.
3. Copy `.env.example` to `.env.local` and fill it in. Generate `OSE_ENCRYPTION_KEY` with `openssl rand -base64 32`.
4. Create the platform owner:
   `npm run bootstrap -- --email you@company.com --password "a-long-password" --org "Overeasy"`
5. `npm run dev`, then sign in → **Manage organization** → create a client workspace from an industry template.
6. Open **Simulator**, submit a lead, then move it through the stages on the lead page and watch **Ad signals**.

Optional durable jobs locally: `npm run inngest:dev` (with `INNGEST_DEV=1`).

## Checks

```
npm run lint        # ESLint (Next + React rules)
npm run typecheck   # tsc --noEmit
npm test            # unit tests: scoring templates, value ladder, window guard, hashing, connector payloads, GHL signatures
npm run test:sql    # applies the migration to an in-memory Postgres and proves RLS tenant isolation
npm run build       # builds the tag, then Next.js (succeeds with no env vars set)
```

## Deploy to Netlify (staging)

1. Push this folder to GitHub (see below).
2. Netlify → **Add new site → Import from Git** → pick the repo. The build settings come from `netlify.toml`: command `npm run build:netlify`, publish `.next`, with `@netlify/plugin-nextjs` pinned.
3. **Site configuration → Environment variables**: add everything in `.env.example`. At minimum you need `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OSE_ENCRYPTION_KEY`, `OSE_HASH_PEPPER`, `APP_URL` (the Netlify URL, no trailing slash) and `CONNECTOR_MODE=dry_run`.
4. Supabase → **Authentication → URL configuration**: set Site URL to the Netlify URL and add `https://<site>.netlify.app/auth/callback` to the redirect URLs.
5. Optional: Inngest Cloud → add the app URL `https://<site>.netlify.app/api/inngest` and set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Netlify. This turns on the retry sweep, health checks and PII purge crons.
6. Redeploy. Every page is `noindex` (staging).

## Operations features

- **Ad spend** (`/w/…/spend`): daily sync from Google Ads (GAQL) and Microsoft (Reporting API) once connections are live, plus CSV import until then.
- **Calibration** (`/w/…/calibration`): proposes stage probabilities and spreads from real outcomes. You approve it before anything is published.
- **Bidding readiness** (`/w/…/readiness`): a checklist plus a playbook for moving bidding to stage values.
- **Connections**: OAuth connect buttons for Google, Microsoft and GHL appear as soon as each platform's client ID and secret are set. Tokens are stored in Vault. There is also one-click creation of per-stage conversion actions or offline goals (secondary by default).
- **Privacy** (`/w/…/privacy`):
  - regulated-vertical mode: click IDs only, no hashed contact data
  - opt-out policy for GPC signals
  - data-subject access/export and delete, with a request log
- **Exports**: leads, signals and spend as CSV. Weekly email summaries go out through Resend under the organization's brand.
- **Org console**: monthly usage per workspace (the basis for billing), and custom domains added to Netlify automatically when `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` are set.
- **Public pages:** product homepage `/` (not login-only, as Google verification requires), `/privacy` (includes the Google API Limited Use statement), `/terms` and `/trust`. All are white-labelled. The privacy and terms pages are **drafts for counsel**; set the `LEGAL_*` variables.
- **Consent-required mode** for EU/UK sites: add `data-consent="required"` to the tag. It stores and sends nothing until the site's consent banner grants `ad_storage`.
- **Data map export** (Privacy page): a per-workspace inventory for the client's privacy assessment.
- **GHL app uninstall** stops sync and wipes the stored tokens.
- **Integrations** (`integrations/`): a Google Tag Manager custom template and a WordPress plugin.
- **CI** (`.github/workflows/ci.yml`): lint, typecheck, unit tests, SQL/RLS isolation test and build on every push.

## v0.4 additions

- **Demo workspace:** one click from the Workspaces page or the organization page. It generates about 300 leads over 120 days, with stage histories, value-ladder uploads (dry run), spend, alerts, CRM operations and an automation registry. It uses the same engines as live traffic, and can be deleted from its banner.
- **No-code scoring builder:** questions, options, points, lead-type conditions, test cases, a live "try it" panel, and publishing gated by validation.
- **Setup checklist** (`/w/…/setup`) and **Reports** (`/w/…/reports`): velocity by lead type, score band vs outcome, and dead spend by lost reason.
- **Outbound webhooks** (Sites & API): HMAC-signed events with retries and a delivery log. Plus **`GET /v1/reports/funnel`**.
- **Historical deal import** (CRM stages page): for reporting and calibration only, never uploaded. You can also **load pipelines from GoHighLevel** with suggested mappings.
- **Two-factor authentication** (Account page) and an organization setting that requires it for admins.
- **Client health** table on the organization page, **error pages**, and public **developer docs** at `/docs`.
- Migration `20260930000000_webhooks_and_security.sql` must be run in Supabase.

## v0.5 additions

- **CRM workflow webhook** (Connections page): `POST /v1/webhooks/workflow/{workspaceId}` with an `X-OSE-Token` header. It works with GoHighLevel workflow "Custom Webhook" actions and needs no Marketplace approval. Contacts not seen by the tag become CRM-only leads.
- **Offline conversion upload files** (Ad signals page): Google Ads and Microsoft Advertising CSVs of stage-value increments that haven't been uploaded yet, with "mark as exported" to track them. Use these until API access is approved.
- **Speed:**
  - Sessions are verified locally with `getClaims()`, so there's no Auth-server round trip per page.
  - Workspace, org chain and role load in one database call (`ose_workspace_context`).
  - Pages show instant loading skeletons, and links prefetch.
  - Set the Netlify **Functions region** to the same region as the Supabase project.
- Migration `20261001000000_speed_and_workflows.sql` must be run in Supabase.

## Integrating a client website

The paths are the tag (any CMS: WordPress, Webflow, Wix, Squarespace, Shopify, GHL funnels, custom), the server Ingest API (`POST /v1/leads`, signed, idempotent), or CRM-only. **Sites & API** in each workspace shows the exact snippet, keys and a live event debugger. The tag never reads password, card or ID fields, skips login forms, and strips query strings from stored URLs.

## Before any live client data (open items)

- Compliance review: US state privacy laws (CCPA/CPRA etc.), Google customer-data and enhanced-conversions policies, Microsoft Advertising policies, GHL Marketplace terms, DPA for partners, consent handling. See the agency docs.
- Platform access applications (these take calendar time): Google OAuth verification (Data Manager scope) and Ads API Basic access, the GHL Marketplace app, and a Microsoft Ads developer token.
- Re-check the Google Data Manager and Microsoft field names against current docs before switching any connection to `test` or `live`.
- OAuth connect flows turn on once the client IDs are issued; token storage (Vault) and refresh are already implemented.


## Branding

- **Platform brand (Overeasy)**: logo lockup, icon and favicons in `public/brand/` (built from the Overeasy logo pack; the horizontal lockup is generated from the master SVG). Tokens live in `src/lib/brand.ts` (`OVEREASY_BRAND`):
  - Colours: Black `#272727` (primary: buttons, links, focus), Orange `#FA942B` (accent), White `#FDF8F3` (page canvas), Yellow `#F9BE61`, Light yellow `#FFFFB1`.
  - Type: Work Sans (body and UI, loaded from Google Fonts). The brand display font Cubano is not on Google Fonts; add a licensed web-font file to `public/brand/` to use it for headings.
- **Where it shows**: the public site and sign-in on the platform domain, the platform organization and Overeasy's **direct** clients.
- **White-label**: anything under a **partner** organization uses the partner's own brand (Org → Branding) over a neutral default. The Overeasy name, logo, font and colours never appear there. `PLATFORM_BRAND=none` turns the Overeasy brand off entirely.

## Website tag v1.1 (form tracking)

One line on any site: `<script async src="https://<tag host>/ose.js" data-site="SITE_KEY"></script>`. It only observes: it never cancels or changes a submit.

- Binds forms added after page load (popups, single-page apps, page builders).
- Counts a lead only after a success signal (success message, form hidden or replaced, page change, or 8 s with no validation errors). Leads with validation errors are dropped. Turn this off with `data-confirm="off"`.
- Embedded third-party forms (HubSpot, Typeform, JotForm, Calendly, GoHighLevel, Tally, and others) are detected through their own submit messages. `data-embed-params="on"` passes `ose_visitor` and click IDs into them. A CRM workflow event carrying `ose_visitor` then merges into the same lead.
- A diagnostics ping (form and field names only, no values) feeds **Sites → Forms found**. **Check install** fetches the site and looks for the snippet.
- Migration `20261002000000_tag_diagnostics.sql` is required.

## Team CRM (agency team area: `/team`)

Internal to the agency; client users (client viewers) never see it. Migration `20261003000000_team_crm.sql` is required. It backfills existing org-level owners and admins as team members.

| Team role | Backed by | Can |
|---|---|---|
| Super-admin | org membership `owner` | Everything, including managing super-admins and permanently deleting archived workspaces |
| Admin | org membership `admin` | Add and edit members, set temporary passwords, send reset emails, assign workspaces, create, edit and delete (archive) workspaces, team overview, audit log |
| User | one workspace membership per assignment (`manager` or `analyst`) | Their assigned workspaces, tasks, reminders, notes and notifications |

- **Logins** live in Supabase Auth; passwords are hashed there and never stored in app tables. An admin either sets a temporary password, which the member must change at first sign-in (enforced in `src/proxy.ts`), or sends an invite email. Disabling a member bans the login.
- **Pages:**
  - My board: workspaces ranked by attention score, my tasks, reminders, notifications.
  - Tasks: list or board, filters, due-date range, pagination.
  - Notifications.
  - Workspace team page: metrics, tasks, internal notes, assigned team, activity.
  - Team overview: workload, unassigned workspaces, health ranking.
  - Members & access.
  - Audit log: date range, action type, member, workspace, pagination and CSV export.
- **Notification sources:**
  - Warning and critical alerts in assigned workspaces (admins get them when nobody is assigned).
  - Contract and funded milestones.
  - Task assigned or done, overdue tasks, task reminders, and personal reminders (checked every 5 minutes by the Inngest retry sweep, and whenever someone opens a team page).
- **Workspace delete:** archives the workspace (hidden; stops accepting website and CRM events) with a 30-day restore window. It is then purged by the retention sweep, or right away by a super-admin using "Delete permanently".

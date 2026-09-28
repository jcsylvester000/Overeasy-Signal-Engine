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

## Integrating a client website

The paths are the tag (any CMS: WordPress, Webflow, Wix, Squarespace, Shopify, GHL funnels, custom), the server Ingest API (`POST /v1/leads`, signed, idempotent), or CRM-only. **Sites & API** in each workspace shows the exact snippet, keys and a live event debugger. The tag never reads password, card or ID fields, skips login forms, and strips query strings from stored URLs.

## Before any live client data (open items)

- Compliance review: US state privacy laws (CCPA/CPRA etc.), Google customer-data and enhanced-conversions policies, Microsoft Advertising policies, GHL Marketplace terms, DPA for partners, consent handling. See the agency docs.
- Platform access applications (these take calendar time): Google OAuth verification (Data Manager scope) and Ads API Basic access, the GHL Marketplace app, and a Microsoft Ads developer token.
- Re-check the Google Data Manager and Microsoft field names against current docs before switching any connection to `test` or `live`.
- OAuth connect flows turn on once the client IDs are issued; token storage (Vault) and refresh are already implemented.

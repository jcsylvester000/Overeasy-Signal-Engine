-- Signal Engine — initial schema (Supabase Postgres).
-- Tenancy: organizations (platform → partner → direct) own workspaces (one per client business).
-- Isolation: RLS on every tenant table, keyed on auth.uid() via app.workspace_rank()/app.org_rank().
-- Server-side ingest, webhooks and jobs use the service role and always scope by workspace_id explicitly.
-- Money: numeric(14,2) + currency char(3). Events are append-only (stage_events, signal_jobs, audit_log).

-- gen_random_uuid() is built into Postgres 13+; no extension needed.

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid references public.organizations(id) on delete restrict,
  type          text not null check (type in ('platform','partner','direct')),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9-]{2,48}$'),
  brand         jsonb not null default '{}'::jsonb,   -- appName, logoUrl, faviconUrl, primary, accent, emailFrom
  custom_domain text unique,                          -- app.partner.com (resolved by host)
  tag_domain    text unique,                          -- t.partner.com
  plan          text not null default 'concept',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.workspaces (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  name              text not null,
  slug              text not null check (slug ~ '^[a-z0-9-]{2,48}$'),
  industry_template text,
  timezone          text not null default 'America/New_York',
  currency          char(3) not null default 'USD',
  settings          jsonb not null default '{}'::jsonb,  -- piiRetentionDays, storeRawPii, consentPolicy, ...
  webhook_secret_enc text,                                -- generic CRM webhook HMAC secret (AES-GCM, app key)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, slug)
);

create table public.memberships (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade, -- null = whole organization
  role         text not null check (role in ('owner','admin','manager','analyst','client_viewer')),
  created_at   timestamptz not null default now(),
  unique nulls not distinct (user_id, org_id, workspace_id)
);
create index on public.memberships (user_id);

-- Role ranks: owner 5, admin 4, manager 3, analyst 2, client_viewer 1.
create or replace function app.role_rank(r text) returns int language sql immutable as $$
  select case r when 'owner' then 5 when 'admin' then 4 when 'manager' then 3
                when 'analyst' then 2 when 'client_viewer' then 1 else 0 end
$$;

-- Organization and its ancestors (a partner's platform, a direct client's partner…).
create or replace function app.org_ancestors(o uuid) returns table(id uuid)
language sql stable security definer set search_path = public as $$
  with recursive up as (
    select id, parent_id, 0 as depth from public.organizations where id = o
    union all
    select p.id, p.parent_id, up.depth + 1 from public.organizations p join up on p.id = up.parent_id where up.depth < 5
  ) select id from up
$$;

-- Highest role the current user holds on an organization (directly or through an ancestor org).
create or replace function app.org_rank(o uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(app.role_rank(m.role)), 0)
  from public.memberships m
  where m.user_id = auth.uid() and m.workspace_id is null
    and m.org_id in (select id from app.org_ancestors(o))
$$;

-- Highest role the current user holds on a workspace (workspace grant, org grant, or ancestor-org grant).
create or replace function app.workspace_rank(ws uuid) returns int
language sql stable security definer set search_path = public as $$
  select greatest(
    coalesce((select max(app.role_rank(m.role)) from public.memberships m
              where m.user_id = auth.uid() and m.workspace_id = ws), 0),
    coalesce((select app.org_rank(w.org_id) from public.workspaces w where w.id = ws), 0)
  )
$$;

-- ---------------------------------------------------------------------------
-- Capture (M1)
-- ---------------------------------------------------------------------------
create table public.sites (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  domain          text not null,
  site_key        text not null unique,                 -- public, embedded in the tag snippet
  allowed_origins text[] not null default '{}',
  tag_version     text,
  last_event_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.visits (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  site_id      uuid not null references public.sites(id) on delete cascade,
  visitor_id   text not null,
  touch        text not null check (touch in ('first','last')),
  gclid text, gbraid text, wbraid text, msclkid text, fbclid text,
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  campaign_id text, adgroup_id text, keyword text, device text,
  landing_url  text,
  referrer     text,
  click_ts     timestamptz,
  consent      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index on public.visits (site_id, visitor_id, created_at desc);
create index on public.visits (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Scoring (M2) and value (M4) models — versioned, immutable once published
-- ---------------------------------------------------------------------------
create table public.scoring_models (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version      int not null,
  status       text not null check (status in ('draft','published','archived')),
  model        jsonb not null,             -- ScoringModel (src/core/scoring/types.ts)
  notes        text,
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (workspace_id, version)
);
create unique index scoring_one_published on public.scoring_models (workspace_id) where status = 'published';

create table public.value_models (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version      int not null,
  status       text not null check (status in ('draft','published','archived')),
  model        jsonb not null,             -- ValueModel (src/core/value/types.ts)
  notes        text,
  published_by uuid references auth.users(id),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (workspace_id, version)
);
create unique index value_one_published on public.value_models (workspace_id) where status = 'published';

-- Published models cannot be edited (only archived).
create or replace function app.guard_published_model() returns trigger language plpgsql as $$
begin
  if old.status = 'published' and (new.model is distinct from old.model or new.version <> old.version) then
    raise exception 'published models are immutable; create a new version';
  end if;
  return new;
end $$;
create trigger scoring_immutable before update on public.scoring_models for each row execute function app.guard_published_model();
create trigger value_immutable   before update on public.value_models   for each row execute function app.guard_published_model();

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table public.leads (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  site_id              uuid references public.sites(id) on delete set null,
  source               text not null check (source in ('tag','api','crm','simulator','import')),
  form                 text,
  external_ref         text,
  visitor_id           text,
  first_touch_visit_id uuid references public.visits(id) on delete set null,
  last_touch_visit_id  uuid references public.visits(id) on delete set null,
  attribution          jsonb not null default '{}'::jsonb,  -- click ids + utm bound server-side at submit
  email_sha256         text,
  phone_sha256         text,
  geo                  text,                                 -- state/region (data, not PII)
  answers              jsonb not null default '{}'::jsonb,
  score                numeric(14,2),
  score_raw            numeric(14,2),
  score_capped         boolean not null default false,
  score_version        int,
  lead_type            text,
  velocity_band        text,
  canonical_stage      text not null default 'submitted',
  lost_reason          text,
  value_current        numeric(14,2) not null default 0,
  currency             char(3) not null default 'USD',
  click_ts             timestamptz,
  window_expires_on    date,
  consent              jsonb not null default '{}'::jsonb,
  is_test              boolean not null default false,
  idempotency_key      text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index on public.leads (workspace_id, created_at desc);
create index on public.leads (workspace_id, email_sha256);
create index on public.leads (workspace_id, phone_sha256);
create index on public.leads (workspace_id, visitor_id);

create table public.lead_pii (
  lead_id      uuid primary key references public.leads(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enc_email    text,
  enc_phone    text,
  enc_name     text,
  purge_after  timestamptz not null
);
create index on public.lead_pii (purge_after);

create table public.stage_events (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  canonical_stage text not null check (canonical_stage in ('submitted','qualified','opportunity','contract','sold','funded','lost')),
  crm_stage_id    text,
  lost_reason     text,
  actual_value    numeric(14,2),            -- optional: actual spread reported at funded (true-up)
  occurred_at     timestamptz not null default now(),
  source          text not null,             -- intake | ghl | generic | api | manual | simulator
  created_at      timestamptz not null default now()
);
create index on public.stage_events (lead_id, occurred_at);
create index on public.stage_events (workspace_id, canonical_stage, occurred_at);

-- ---------------------------------------------------------------------------
-- CRM lifecycle (M3)
-- ---------------------------------------------------------------------------
create table public.connections (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  provider         text not null check (provider in ('ghl','google_ads','microsoft_ads','generic_crm')),
  mode             text not null default 'dry_run' check (mode in ('dry_run','test','live')),
  external_account text,                     -- GHL locationId / Google customer id / Microsoft account id
  login_account    text,                     -- Google manager (MCC) id, Microsoft customer id
  display_name     text,
  token_secret_id  uuid,                     -- Supabase Vault secret id (OAuth tokens JSON)
  scopes           text[] not null default '{}',
  settings         jsonb not null default '{}'::jsonb,
  status           text not null default 'ok' check (status in ('ok','error','expired','disconnected')),
  last_ok_at       timestamptz,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, provider, external_account)
);
create index on public.connections (provider, external_account);

create table public.stage_maps (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  provider        text not null,
  pipeline_id     text not null,
  pipeline_name   text,
  stage_id        text not null,
  stage_name      text,
  canonical_stage text not null check (canonical_stage in ('submitted','qualified','opportunity','contract','sold','funded','lost','ignore')),
  created_at      timestamptz not null default now(),
  unique (workspace_id, provider, pipeline_id, stage_id)
);

create table public.crm_links (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  lead_id        uuid not null references public.leads(id) on delete cascade,
  provider       text not null,
  contact_id     text,
  opportunity_id text,
  created_at     timestamptz not null default now(),
  unique (workspace_id, provider, contact_id),
  unique (workspace_id, provider, opportunity_id)
);
create index on public.crm_links (lead_id);

create table public.webhook_inbox (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  provider     text not null,
  webhook_id   text not null,
  event_type   text,
  signature_ok boolean not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,
  unique (provider, webhook_id)
);

-- ---------------------------------------------------------------------------
-- Delivery (M5)
-- ---------------------------------------------------------------------------
create table public.conversion_destinations (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  connection_id        uuid not null references public.connections(id) on delete cascade,
  platform             text not null check (platform in ('google','microsoft')),
  canonical_stage      text not null,
  conversion_action_id text,                -- Google conversion action id (productDestinationId)
  goal_name            text,                -- Microsoft offline conversion goal name
  role                 text not null default 'secondary' check (role in ('primary','secondary')),
  created_at           timestamptz not null default now(),
  unique (connection_id, canonical_stage)
);

create table public.signal_jobs (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  lead_id          uuid not null references public.leads(id) on delete cascade,
  connection_id    uuid references public.connections(id) on delete set null,
  platform         text not null check (platform in ('google','microsoft')),
  mode             text not null check (mode in ('dry_run','test','live')),
  canonical_stage  text not null,
  idempotency_key  text not null unique,     -- ws:lead:stage:platform:mode
  transaction_id   text not null,            -- leadId-stage (Google dedupes on it)
  match_type       text,                     -- click_id | enhanced_leads
  value_increment  numeric(14,2) not null,
  cumulative_after numeric(14,2) not null,
  currency         char(3) not null,
  status           text not null check (status in ('pending','sending','sent','failed','dead','blocked_window','no_click_id','no_destination','skipped','dry_run','test')),
  attempts         int not null default 0,
  request          jsonb,
  response         jsonb,
  error            text,
  next_attempt_at  timestamptz,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.signal_jobs (workspace_id, created_at desc);
create index on public.signal_jobs (status, next_attempt_at);
create index on public.signal_jobs (lead_id);

-- Every write OSE makes (or would make, in dry_run) to a CRM: contact upserts, field write-back.
create table public.crm_ops (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id      uuid references public.leads(id) on delete cascade,
  provider     text not null,
  op           text not null,          -- upsert_contact | write_back | create_fields
  mode         text not null check (mode in ('dry_run','test','live')),
  status       text not null check (status in ('ok','failed','dry_run','skipped')),
  request      jsonb,
  response     jsonb,
  error        text,
  created_at   timestamptz not null default now()
);
create index on public.crm_ops (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Reporting (M6), health (M7), platform (M8)
-- ---------------------------------------------------------------------------
create table public.ad_spend_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform     text not null,
  date         date not null,
  campaign_id  text not null default '',
  campaign     text,
  adgroup_id   text not null default '',
  geo          text not null default '',
  cost         numeric(14,2) not null default 0,
  clicks       int not null default 0,
  impressions  int not null default 0,
  primary key (workspace_id, platform, date, campaign_id, adgroup_id, geo)
);

create table public.alerts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type         text not null,  -- sync_failure | connection_expired | tag_missing | window_expiry | webhook_signature | stage_anomaly
  severity     text not null check (severity in ('info','warning','critical')),
  status       text not null default 'open' check (status in ('open','acknowledged','resolved')),
  title        text not null,
  detail       jsonb not null default '{}'::jsonb,
  dedupe_key   text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create unique index alerts_open_dedupe on public.alerts (workspace_id, dedupe_key) where status <> 'resolved';

create table public.automations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  system       text not null,       -- ose | ghl | make | zapier | callrail | other
  owner        text,
  trigger      text,
  updates      text,
  on_failure   text,
  access       text,
  last_run_at  timestamptz,
  status       text not null default 'unknown',
  created_at   timestamptz not null default now()
);

create table public.audit_log (
  id           bigint generated always as identity primary key,
  org_id       uuid references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  actor_id     uuid,
  action       text not null,
  entity       text,
  entity_id    text,
  diff         jsonb,
  at           timestamptz not null default now()
);
create index on public.audit_log (workspace_id, at desc);
create index on public.audit_log (org_id, at desc);

create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  prefix       text not null unique,          -- first chars shown in the UI and used for lookup
  hashed_key   text not null,                 -- sha256(full key)
  scopes       text[] not null default '{ingest,read}',
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now()
);

-- Ingest idempotency (Idempotency-Key header on POST /v1/leads)
create table public.idempotency_keys (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  response     jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, key)
);

-- Audit log is append-only.
create or replace function app.deny_mutation() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name; end $$;
create trigger audit_append_only before update or delete on public.audit_log for each row execute function app.deny_mutation();
create trigger stage_events_append_only before update on public.stage_events for each row execute function app.deny_mutation();

-- updated_at maintenance
create or replace function app.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_orgs before update on public.organizations for each row execute function app.touch();
create trigger t_ws   before update on public.workspaces   for each row execute function app.touch();
create trigger t_site before update on public.sites        for each row execute function app.touch();
create trigger t_lead before update on public.leads        for each row execute function app.touch();
create trigger t_conn before update on public.connections  for each row execute function app.touch();
create trigger t_job  before update on public.signal_jobs  for each row execute function app.touch();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
create policy org_read   on public.organizations for select to authenticated using (app.org_rank(id) >= 1
  or exists (select 1 from public.workspaces w where w.org_id = organizations.id and app.workspace_rank(w.id) >= 1));
create policy org_update on public.organizations for update to authenticated using (app.org_rank(id) >= 4) with check (app.org_rank(id) >= 4);
create policy org_insert on public.organizations for insert to authenticated with check (parent_id is not null and app.org_rank(parent_id) >= 4);

alter table public.workspaces enable row level security;
create policy ws_read   on public.workspaces for select to authenticated using (app.workspace_rank(id) >= 1);
create policy ws_insert on public.workspaces for insert to authenticated with check (app.org_rank(org_id) >= 4);
create policy ws_update on public.workspaces for update to authenticated using (app.workspace_rank(id) >= 4) with check (app.workspace_rank(id) >= 4);

alter table public.memberships enable row level security;
create policy mem_read on public.memberships for select to authenticated using (
  user_id = auth.uid() or app.org_rank(org_id) >= 4 or (workspace_id is not null and app.workspace_rank(workspace_id) >= 4));
create policy mem_write on public.memberships for all to authenticated
  using (app.org_rank(org_id) >= 4 and role <> 'owner')
  with check (app.org_rank(org_id) >= 4 and role <> 'owner');

-- Generic workspace policies: read = any member; config write = manager+.
do $$
declare t text;
begin
  foreach t in array array['sites','scoring_models','value_models','connections','stage_maps','conversion_destinations','automations','alerts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.workspace_rank(workspace_id) >= 1)', t||'_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.workspace_rank(workspace_id) >= 3)', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (app.workspace_rank(workspace_id) >= 3) with check (app.workspace_rank(workspace_id) >= 3)', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (app.workspace_rank(workspace_id) >= 3)', t||'_del', t);
  end loop;
  -- Read-only for users; written by the server (service role).
  foreach t in array array['visits','leads','stage_events','crm_links','signal_jobs','ad_spend_daily','webhook_inbox','crm_ops'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app.workspace_rank(workspace_id) >= 1)', t||'_read', t);
  end loop;
end $$;

-- Raw PII: admins only, and only if stored at all.
alter table public.lead_pii enable row level security;
create policy lead_pii_read on public.lead_pii for select to authenticated using (app.workspace_rank(workspace_id) >= 4);

alter table public.api_keys enable row level security;
create policy api_keys_read on public.api_keys for select to authenticated using (app.workspace_rank(workspace_id) >= 4);

alter table public.idempotency_keys enable row level security; -- service role only

alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated using (
  (workspace_id is not null and app.workspace_rank(workspace_id) >= 3) or (org_id is not null and app.org_rank(org_id) >= 4));

-- ---------------------------------------------------------------------------
-- Vault wrappers (service role only): OAuth tokens never stored in plaintext tables.
-- ---------------------------------------------------------------------------
create or replace function app.vault_put(p_name text, p_secret text) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = p_name;
  if sid is null then
    sid := vault.create_secret(p_secret, p_name);
  else
    perform vault.update_secret(sid, p_secret);
  end if;
  return sid;
end $$;

create or replace function app.vault_get(p_id uuid) returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id
$$;

revoke all on function app.vault_put(text, text) from public, anon, authenticated;
revoke all on function app.vault_get(uuid) from public, anon, authenticated;
grant execute on function app.vault_put(text, text) to service_role;
grant execute on function app.vault_get(uuid) to service_role;

-- Public RPC wrappers so supabase-js (which only exposes the public schema) can reach them with the service role.
create or replace function public.ose_vault_put(p_name text, p_secret text) returns uuid
language sql security definer set search_path = public as $$ select app.vault_put(p_name, p_secret) $$;
create or replace function public.ose_vault_get(p_id uuid) returns text
language sql security definer set search_path = public as $$ select app.vault_get(p_id) $$;
revoke all on function public.ose_vault_put(text, text) from public, anon, authenticated;
revoke all on function public.ose_vault_get(uuid) from public, anon, authenticated;
grant execute on function public.ose_vault_put(text, text) to service_role;
grant execute on function public.ose_vault_get(uuid) to service_role;

-- Current user's workspace role, callable from the app (RLS-safe).
create or replace function public.ose_workspace_rank(ws uuid) returns int
language sql stable security definer set search_path = public as $$ select app.workspace_rank(ws) $$;
create or replace function public.ose_org_rank(o uuid) returns int
language sql stable security definer set search_path = public as $$ select app.org_rank(o) $$;
grant execute on function public.ose_workspace_rank(uuid) to authenticated;
grant execute on function public.ose_org_rank(uuid) to authenticated;
grant execute on function app.workspace_rank(uuid), app.org_rank(uuid), app.org_ancestors(uuid), app.role_rank(text) to authenticated;

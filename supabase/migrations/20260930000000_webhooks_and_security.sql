-- Outbound webhooks (spec §17), organization settings (MFA policy), historical import flag.

create table if not exists public.outbound_webhooks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  url           text not null check (url ~ '^https://'),
  secret_enc    text not null,
  events        text[] not null default '{lead.created,lead.stage_changed,signal.sent,signal.failed,alert.raised}',
  active        boolean not null default true,
  last_status   int,
  last_at       timestamptz,
  failures      int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists outbound_webhooks_ws on public.outbound_webhooks (workspace_id);

create table if not exists public.outbound_deliveries (
  id            uuid primary key default gen_random_uuid(),
  webhook_id    uuid not null references public.outbound_webhooks(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  event         text not null,
  payload       jsonb not null,
  status        text not null default 'pending' check (status in ('pending','delivered','failed','dead')),
  attempts      int not null default 0,
  response_code int,
  error         text,
  next_attempt_at timestamptz,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz
);
create index if not exists outbound_deliveries_due on public.outbound_deliveries (status, next_attempt_at);
create index if not exists outbound_deliveries_ws on public.outbound_deliveries (workspace_id, created_at desc);

alter table public.outbound_webhooks enable row level security;
drop policy if exists ow_read on public.outbound_webhooks;
create policy ow_read on public.outbound_webhooks for select to authenticated using (app.workspace_rank(workspace_id) >= 4);
alter table public.outbound_deliveries enable row level security;
drop policy if exists od_read on public.outbound_deliveries;
create policy od_read on public.outbound_deliveries for select to authenticated using (app.workspace_rank(workspace_id) >= 3);

alter table public.organizations add column if not exists settings jsonb not null default '{}'::jsonb;  -- requireMfaForAdmins, ...

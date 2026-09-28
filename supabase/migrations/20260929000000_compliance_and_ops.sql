-- Compliance + operations additions (2026-09-29).
--  * Microsoft-specific email hash (per-destination normalisation, backlog B7)
--  * Regulated-vertical / sensitive-data mode and opt-out handling live in workspaces.settings (no schema change)
--  * DSAR request log (B3)
--  * Monthly usage view for billing preparation (security_invoker so RLS applies)

alter table public.leads add column if not exists email_sha256_ms text;
create index if not exists leads_email_ms_idx on public.leads (workspace_id, email_sha256_ms);

create table if not exists public.dsar_requests (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  kind          text not null check (kind in ('access','delete')),
  subject_hash  text not null,              -- sha256 of the normalised email or phone; never the raw value
  matched_leads int not null default 0,
  status        text not null default 'completed' check (status in ('completed','failed')),
  detail        jsonb not null default '{}'::jsonb,  -- transaction ids that need platform retraction, counts
  requested_by  uuid,
  created_at    timestamptz not null default now()
);
alter table public.dsar_requests enable row level security;
drop policy if exists dsar_read on public.dsar_requests;
create policy dsar_read on public.dsar_requests for select to authenticated using (app.workspace_rank(workspace_id) >= 4);

create or replace view public.usage_monthly with (security_invoker = true) as
  select w.id as workspace_id, w.org_id, date_trunc('month', l.created_at)::date as month,
         count(*) filter (where not l.is_test) as leads,
         count(*) filter (where l.is_test) as test_leads
  from public.workspaces w
  join public.leads l on l.workspace_id = w.id
  group by 1, 2, 3;
grant select on public.usage_monthly to authenticated;

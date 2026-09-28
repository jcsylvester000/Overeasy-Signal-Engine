-- Team CRM (2026-10-03): agency team roles, workspace assignments, tasks, reminders, notes, notifications,
-- workspace archive. Team data is internal to the agency: client users (client_viewer) never see it.
--
-- Team roles (per organization that runs a team, usually the platform org):
--   super_admin → org membership 'owner'  (everything, manages admins, permanent deletes)
--   admin       → org membership 'admin'  (users, workspaces, assignments, all tasks, audit)
--   user        → no org-wide access; one workspace membership per assignment ('manager' or 'analyst')
-- All reads/writes go through server code with explicit checks; RLS below is defence in depth.

-- ---------------------------------------------------------------- workspace archive
alter table public.workspaces add column if not exists archived_at timestamptz;
alter table public.workspaces add column if not exists archived_by uuid;
create index if not exists workspaces_archived on public.workspaces (archived_at) where archived_at is not null;

-- ---------------------------------------------------------------- team
create table if not exists public.team_members (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  team_role   text not null check (team_role in ('super_admin','admin','user')),
  full_name   text,
  title       text,
  phone       text,
  status      text not null default 'active' check (status in ('active','disabled')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists team_members_user on public.team_members (user_id);

create table if not exists public.workspace_assignments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  team_org_id  uuid not null references public.organizations(id) on delete cascade,
  access       text not null default 'manager' check (access in ('manager','analyst')),
  is_lead      boolean not null default false,
  assigned_by  uuid,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_assignments_user on public.workspace_assignments (user_id);

create table if not exists public.team_tasks (
  id           uuid primary key default gen_random_uuid(),
  team_org_id  uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  title        text not null check (length(title) between 1 and 200),
  description  text,
  status       text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  priority     text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id  uuid references auth.users(id) on delete set null,
  created_by   uuid,
  due_at       timestamptz,
  remind_at    timestamptz,
  reminded_at  timestamptz,
  overdue_notified_at timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists team_tasks_assignee on public.team_tasks (assignee_id, status, due_at);
create index if not exists team_tasks_ws on public.team_tasks (workspace_id, status);
create index if not exists team_tasks_org on public.team_tasks (team_org_id, status, due_at);
create index if not exists team_tasks_remind on public.team_tasks (remind_at) where reminded_at is null and status <> 'done';

create table if not exists public.team_reminders (
  id           uuid primary key default gen_random_uuid(),
  team_org_id  uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  note         text not null check (length(note) between 1 and 300),
  remind_at    timestamptz not null,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists team_reminders_due on public.team_reminders (remind_at) where sent_at is null;
create index if not exists team_reminders_user on public.team_reminders (user_id, remind_at);

create table if not exists public.team_notes (
  id           uuid primary key default gen_random_uuid(),
  team_org_id  uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  author_id    uuid,
  body         text not null check (length(body) between 1 and 4000),
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists team_notes_ws on public.team_notes (workspace_id, pinned desc, created_at desc);

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  team_org_id  uuid references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text,
  link         text,
  dedupe_key   text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread on public.notifications (user_id) where read_at is null;
create unique index if not exists notifications_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

create index if not exists audit_log_at on public.audit_log (at desc);
create index if not exists audit_log_actor on public.audit_log (actor_id, at desc);

create trigger t_team_members before update on public.team_members for each row execute function app.touch();
create trigger t_team_tasks   before update on public.team_tasks   for each row execute function app.touch();
create trigger t_team_notes   before update on public.team_notes   for each row execute function app.touch();

-- ---------------------------------------------------------------- helpers
-- Team role of the current user in an organization's team, or null.
create or replace function app.team_role(o uuid) returns text
language sql stable security definer set search_path = public as $$
  select team_role from public.team_members where org_id = o and user_id = auth.uid() and status = 'active'
$$;
grant execute on function app.team_role(uuid) to authenticated;

-- ---------------------------------------------------------------- RLS (reads; writes are service-role only)
alter table public.team_members          enable row level security;
alter table public.workspace_assignments enable row level security;
alter table public.team_tasks            enable row level security;
alter table public.team_reminders        enable row level security;
alter table public.team_notes            enable row level security;
alter table public.notifications         enable row level security;

create policy team_members_read on public.team_members for select to authenticated using (app.team_role(org_id) is not null);
create policy assignments_read on public.workspace_assignments for select to authenticated
  using (user_id = auth.uid() or app.team_role(team_org_id) in ('super_admin','admin'));
create policy tasks_read on public.team_tasks for select to authenticated
  using (app.team_role(team_org_id) in ('super_admin','admin') or assignee_id = auth.uid() or created_by = auth.uid()
         or (workspace_id is not null and exists (select 1 from public.workspace_assignments a where a.workspace_id = team_tasks.workspace_id and a.user_id = auth.uid())));
create policy reminders_read on public.team_reminders for select to authenticated using (user_id = auth.uid());
create policy notes_read on public.team_notes for select to authenticated
  using (app.team_role(team_org_id) in ('super_admin','admin')
         or exists (select 1 from public.workspace_assignments a where a.workspace_id = team_notes.workspace_id and a.user_id = auth.uid()));
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- workspace metrics for team boards (service role only)
create or replace function public.ose_team_ws_metrics(p_ws uuid[]) returns table (
  workspace_id uuid, leads_7d int, leads_30d int, qualified_7d int, contracts_30d int, funded_30d int,
  alerts_open int, alerts_critical int, failed_30d int, last_tag_event timestamptz, last_lead_at timestamptz, open_tasks int, overdue_tasks int
) language sql stable security definer set search_path = public as $$
  select w.id,
    (select count(*) from leads l where l.workspace_id = w.id and not l.is_test and l.created_at >= now() - interval '7 days')::int,
    (select count(*) from leads l where l.workspace_id = w.id and not l.is_test and l.created_at >= now() - interval '30 days')::int,
    (select count(distinct s.lead_id) from stage_events s where s.workspace_id = w.id and s.canonical_stage = 'qualified' and s.occurred_at >= now() - interval '7 days')::int,
    (select count(distinct s.lead_id) from stage_events s where s.workspace_id = w.id and s.canonical_stage = 'contract' and s.occurred_at >= now() - interval '30 days')::int,
    (select count(distinct s.lead_id) from stage_events s where s.workspace_id = w.id and s.canonical_stage = 'funded' and s.occurred_at >= now() - interval '30 days')::int,
    (select count(*) from alerts a where a.workspace_id = w.id and a.status <> 'resolved')::int,
    (select count(*) from alerts a where a.workspace_id = w.id and a.status <> 'resolved' and a.severity = 'critical')::int,
    (select count(*) from signal_jobs j where j.workspace_id = w.id and j.status in ('dead','failed') and j.created_at >= now() - interval '30 days')::int,
    (select max(st.last_event_at) from sites st where st.workspace_id = w.id),
    (select max(l.created_at) from leads l where l.workspace_id = w.id and not l.is_test),
    (select count(*) from team_tasks t where t.workspace_id = w.id and t.status <> 'done')::int,
    (select count(*) from team_tasks t where t.workspace_id = w.id and t.status <> 'done' and t.due_at < now())::int
  from workspaces w where w.id = any(p_ws)
$$;
revoke all on function public.ose_team_ws_metrics(uuid[]) from public, anon, authenticated;
grant execute on function public.ose_team_ws_metrics(uuid[]) to service_role;

-- ---------------------------------------------------------------- backfill: existing org-level staff become team members
insert into public.team_members (org_id, user_id, team_role)
select m.org_id, m.user_id,
       case m.role when 'owner' then 'super_admin' when 'admin' then 'admin' else 'user' end
from public.memberships m
where m.workspace_id is null and m.role in ('owner','admin','manager','analyst')
on conflict (org_id, user_id) do nothing;

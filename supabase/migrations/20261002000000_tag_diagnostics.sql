-- Tag v1.1 diagnostics (2026-10-02)
--  * site_pages: forms and embedded forms the tag found per page (no personal data) → install check / "forms found"
--  * sites.last_check: result of the server-side "Check install" fetch
--  * leads.capture_via: how a website lead was confirmed (success, form-hidden, navigated, timeout, submit, api, embed:<vendor>)

alter table public.leads add column if not exists capture_via text;
alter table public.sites add column if not exists last_check jsonb;

create table if not exists public.site_pages (
  site_id       uuid not null references public.sites(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  path          text not null,
  forms         jsonb not null default '[]'::jsonb,
  embeds        jsonb not null default '[]'::jsonb,
  tag_version   text,
  hits          int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (site_id, path)
);
create index if not exists site_pages_ws on public.site_pages (workspace_id, last_seen_at desc);
alter table public.site_pages enable row level security;
drop policy if exists site_pages_read on public.site_pages;
create policy site_pages_read on public.site_pages for select to authenticated using (app.workspace_rank(workspace_id) >= 1);

-- Upsert from /v1/collect (service role only). Caps each site at 300 tracked paths.
create or replace function public.ose_site_ping(p_site uuid, p_ws uuid, p_path text, p_forms jsonb, p_embeds jsonb, p_version text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.site_pages where site_id = p_site and path = p_path)
     and (select count(*) from public.site_pages where site_id = p_site) >= 300 then
    return;
  end if;
  insert into public.site_pages (site_id, workspace_id, path, forms, embeds, tag_version)
  values (p_site, p_ws, left(p_path, 200), coalesce(p_forms, '[]'::jsonb), coalesce(p_embeds, '[]'::jsonb), p_version)
  on conflict (site_id, path) do update
    set forms = excluded.forms, embeds = excluded.embeds, tag_version = excluded.tag_version,
        hits = public.site_pages.hits + 1, last_seen_at = now();
end $$;
revoke all on function public.ose_site_ping(uuid, uuid, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.ose_site_ping(uuid, uuid, text, jsonb, jsonb, text) to service_role;

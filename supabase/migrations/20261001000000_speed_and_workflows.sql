-- Speed + no-approval workflows (2026-10-01)
--  * ose_workspace_context(): workspace, org chain (for brand/MFA) and the caller's rank in ONE round trip
--  * workspaces.inbound_token_hash: static-token webhook for CRM workflow tools (e.g. GHL workflow "Webhook" action)
--  * signal_jobs.exported_at: offline-conversion CSV export tracking

alter table public.workspaces add column if not exists inbound_token_hash text;
create unique index if not exists workspaces_inbound_token on public.workspaces (inbound_token_hash) where inbound_token_hash is not null;

alter table public.signal_jobs add column if not exists exported_at timestamptz;
create index if not exists signal_jobs_export on public.signal_jobs (workspace_id, platform, exported_at);

create or replace function public.ose_workspace_context(ws uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r int := app.workspace_rank(ws);
  w public.workspaces;
begin
  if r < 1 then return null; end if;
  select * into w from public.workspaces where id = ws;
  if not found then return null; end if;
  return jsonb_build_object(
    'rank', r,
    'workspace', to_jsonb(w) - 'webhook_secret_enc' - 'inbound_token_hash',
    'orgs', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'parent_id', o.parent_id, 'type', o.type, 'name', o.name, 'slug', o.slug,
                                                         'brand', o.brand, 'custom_domain', o.custom_domain, 'tag_domain', o.tag_domain, 'settings', o.settings)), '[]'::jsonb)
             from public.organizations o where o.id in (select id from app.org_ancestors(w.org_id)))
  );
end $$;
revoke all on function public.ose_workspace_context(uuid) from public, anon;
grant execute on function public.ose_workspace_context(uuid) to authenticated;

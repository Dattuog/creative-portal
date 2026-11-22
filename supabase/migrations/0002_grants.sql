-- Newer Supabase projects don't auto-grant table access to the API roles.
-- Signed-in users can only read; RLS policies decide which rows.
grant usage on schema public to authenticated, service_role;
grant select on public.profiles, public.settings, public.adsets, public.creatives, public.creative_owners,
  public.meta_insights_daily, public.shopify_orders, public.sync_runs, public.agent_reports, public.agent_actions
  to authenticated;
-- The server (secret key) does all writes.
grant all on all tables in schema public to service_role;
grant execute on function public.my_role(), public.my_person(), public.can_see_ad(text) to authenticated, service_role;

-- 3tap's browser never talks directly to these tables. All database access goes
-- through authenticated server routes using SUPABASE_SERVICE_ROLE_KEY.
-- Make those server-side privileges explicit so UPDATE/DELETE behavior is the
-- same on fresh local databases and hosted Supabase projects.
grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.boards,
  public.habits,
  public.entries
to service_role;

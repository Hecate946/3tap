grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.boards,
  public.habits,
  public.entries
to service_role;

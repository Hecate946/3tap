-- Custom 3tap auth stores its own login sessions in this table.
-- The table was introduced after the original service-role grant migration,
-- so explicitly grant PostgREST access to it for server-side requests.
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.board_sessions to service_role;

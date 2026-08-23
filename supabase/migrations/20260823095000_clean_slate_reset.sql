-- Requested one-time clean slate for 3tap.
-- Permanently removes every existing anonymous board and all habit/history data.
-- New boards are created empty by src/routes/api/boards/+server.ts.
truncate table public.entries, public.habits, public.boards restart identity cascade;

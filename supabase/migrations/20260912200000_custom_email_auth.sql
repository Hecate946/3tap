-- 3tap owns authentication directly. This keeps local development and
-- production independent of Supabase Auth/SMTP configuration.
alter table public.boards add column if not exists email text;
alter table public.boards add column if not exists password_hash text;
create unique index if not exists boards_email_unique_idx
  on public.boards (lower(email)) where email is not null;

create table if not exists public.board_sessions (
  token_hash text primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists board_sessions_board_idx on public.board_sessions(board_id);
alter table public.board_sessions enable row level security;

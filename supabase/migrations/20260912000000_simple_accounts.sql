alter table public.boards add column if not exists username text;
alter table public.boards add column if not exists password_hash text;
create unique index if not exists boards_username_unique_idx on public.boards (lower(username)) where username is not null;

create table if not exists public.board_sessions (
  token_hash text primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists board_sessions_board_idx on public.board_sessions(board_id);
alter table public.board_sessions enable row level security;

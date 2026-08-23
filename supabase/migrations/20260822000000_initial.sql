create extension if not exists pgcrypto;

create table if not exists public.boards (
  id uuid primary key,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.boards
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.habits (
  id uuid primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table public.habits
  add column if not exists archived_at timestamptz;

create index if not exists habits_board_position_idx
  on public.habits(board_id, position);

create index if not exists habits_board_archived_idx
  on public.habits(board_id, archived_at);

create table if not exists public.entries (
  board_id uuid not null references public.boards(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  entry_date date not null,
  value smallint not null check (value in (1, 2)),
  updated_at timestamptz not null default now(),
  primary key (board_id, habit_id, entry_date)
);

alter table public.boards enable row level security;
alter table public.habits enable row level security;
alter table public.entries enable row level security;

-- No public policies by design. 3tap's browser talks only to SvelteKit API routes;
-- those server routes authenticate boards and use the Supabase secret key.

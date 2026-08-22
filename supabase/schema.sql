create extension if not exists pgcrypto;

create table if not exists public.boards (
  id uuid primary key,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe upgrade for boards created with the first 3tap schema.
alter table public.boards
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.habits (
  id uuid primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  position integer not null,
  created_at timestamptz not null default now()
);

create index if not exists habits_board_position_idx
  on public.habits(board_id, position);

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

-- Intentionally no public RLS policies.
-- The browser never talks to Supabase directly; only server routes use the secret key.

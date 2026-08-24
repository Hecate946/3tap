create table if not exists public.thoughts (
  id uuid primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 240),
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists thoughts_board_position_idx
  on public.thoughts(board_id, position);

alter table public.thoughts enable row level security;

grant select, insert, update, delete on table public.thoughts to service_role;

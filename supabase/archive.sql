alter table public.habits
  add column if not exists archived_at timestamptz;

create index if not exists habits_board_archived_idx
  on public.habits(board_id, archived_at);

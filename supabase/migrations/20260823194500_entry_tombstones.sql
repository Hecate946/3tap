alter table public.entries drop constraint if exists entries_value_check;
alter table public.entries
  add constraint entries_value_check check (value in (0, 1, 2));

create index if not exists entries_board_updated_idx
  on public.entries(board_id, updated_at);

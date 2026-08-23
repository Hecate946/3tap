alter table public.boards
  add column if not exists recovery_hash text;

create unique index if not exists boards_recovery_hash_idx
  on public.boards(recovery_hash)
  where recovery_hash is not null;

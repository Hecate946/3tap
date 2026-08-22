-- Run this once if you already ran the original 3tap schema.
alter table public.boards
  add column if not exists updated_at timestamptz not null default now();


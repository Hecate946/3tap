create table if not exists public.password_reset_tokens (
  token_hash text primary key,
  board_id uuid not null references public.boards(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_board_idx
  on public.password_reset_tokens(board_id);
create index if not exists password_reset_tokens_expiry_idx
  on public.password_reset_tokens(expires_at);

alter table public.password_reset_tokens enable row level security;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.password_reset_tokens to service_role;

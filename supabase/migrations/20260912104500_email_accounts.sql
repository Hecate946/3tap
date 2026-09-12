alter table public.boards add column if not exists auth_user_id uuid;
alter table public.boards add column if not exists email text;
alter table public.boards add column if not exists display_name text;

create unique index if not exists boards_auth_user_unique_idx on public.boards(auth_user_id) where auth_user_id is not null;
create unique index if not exists boards_email_unique_idx on public.boards(lower(email)) where email is not null;

-- v51 Reader cloud library sync
-- Run this once in Supabase SQL Editor if reader texts should sync between devices.

create table if not exists public.reader_books (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists reader_books_user_updated_idx
  on public.reader_books (user_id, updated_at desc);

alter table public.reader_books enable row level security;

drop policy if exists "reader_books_select_own" on public.reader_books;
drop policy if exists "reader_books_insert_own" on public.reader_books;
drop policy if exists "reader_books_update_own" on public.reader_books;
drop policy if exists "reader_books_delete_own" on public.reader_books;

create policy "reader_books_select_own"
  on public.reader_books for select
  using (auth.uid() = user_id);

create policy "reader_books_insert_own"
  on public.reader_books for insert
  with check (auth.uid() = user_id);

create policy "reader_books_update_own"
  on public.reader_books for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reader_books_delete_own"
  on public.reader_books for delete
  using (auth.uid() = user_id);

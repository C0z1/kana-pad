-- Kana Pad cloud sync: one profile row and one progress document per user.
-- Applied to the Supabase project "kana-pad" (izthfajqnazsgdhflcel).
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  daily_goal integer not null default 20 check (daily_goal between 1 and 500),
  target_level text check (target_level in ('n5', 'n4', 'n3')),
  target_date date,
  updated_at timestamptz not null default now()
);

-- The whole local progress (same shape as an export file); merged card by card on the client.
create table public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint progress_size check (pg_column_size(data) < 5000000)
);

alter table public.profiles enable row level security;
alter table public.progress enable row level security;

-- Each user reads and writes only their own row.
create policy "own profile: select" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "own profile: insert" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own profile: update" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own profile: delete" on public.profiles for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own progress: select" on public.progress for select to authenticated using ((select auth.uid()) = user_id);
create policy "own progress: insert" on public.progress for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own progress: update" on public.progress for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own progress: delete" on public.progress for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.progress from anon;
grant select, insert, update, delete on public.profiles, public.progress to authenticated;

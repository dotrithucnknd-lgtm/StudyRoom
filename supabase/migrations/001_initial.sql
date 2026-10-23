create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  learning_language text not null default 'English',
  daily_goal integer not null default 20 check (daily_goal between 1 and 1000),
  avatar_url text,
  created_at timestamptz not null default now()
);
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);
create table public.study_sets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  source_language text not null default 'English',
  target_language text not null default 'Tiếng Việt',
  visibility text not null default 'private' check (visibility in ('private','public')),
  tags text[] not null default '{}',
  cover_color text not null default 'violet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.study_sets(id) on delete cascade,
  term text not null check (char_length(term) between 1 and 300),
  definition text not null check (char_length(definition) between 1 and 3000),
  phonetic text not null default '',
  example text not null default '',
  example_translation text not null default '',
  notes text not null default '',
  synonyms text not null default '',
  antonyms text not null default '',
  tags text[] not null default '{}',
  favorite boolean not null default false,
  difficult boolean not null default false,
  mastered boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.set_shares (
  set_id uuid not null references public.study_sets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  primary key(set_id,user_id)
);
create table public.card_progress (
  card_id uuid not null references public.flashcards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'new' check (state in ('new','learning','review','relearning','mastered')),
  ease real not null default 2.5,
  interval_days real not null default 0,
  repetitions integer not null default 0,
  lapses integer not null default 0,
  correct_count integer not null default 0,
  wrong_count integer not null default 0,
  last_reviewed_at timestamptz,
  due_at timestamptz not null default now(),
  primary key(card_id,user_id)
);
create table public.review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid references public.flashcards(id) on delete set null,
  rating text not null check (rating in ('again','hard','good','easy')),
  interval_days real not null,
  created_at timestamptz not null default now()
);
create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  set_id uuid references public.study_sets(id) on delete set null,
  mode text not null check (mode in ('flashcards','learn','match','test','review')),
  correct integer not null default 0,
  total integer not null default 0,
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.study_sets(owner_id, updated_at desc);
create index on public.study_sets(visibility, updated_at desc) where visibility='public';
create index on public.flashcards(set_id, position);
create index on public.card_progress(user_id, due_at);
create index on public.study_sessions(user_id, created_at desc);
create index on public.review_logs(user_id, created_at desc);

create function public.touch_set() returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.study_sets set updated_at=now() where id=coalesce(new.set_id,old.set_id);
  return coalesce(new,old);
end $$;
create trigger flashcard_touch after insert or update or delete on public.flashcards for each row execute function public.touch_set();
create function public.new_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'display_name','')); return new; end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.new_profile();
create function public.can_view_set(target uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.study_sets s where s.id=target and (s.owner_id=auth.uid() or s.visibility='public' or exists(select 1 from public.set_shares sh where sh.set_id=s.id and sh.user_id=auth.uid())))
$$;
create function public.can_edit_cards(target uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.study_sets s where s.id=target and (s.owner_id=auth.uid() or exists(select 1 from public.set_shares sh where sh.set_id=s.id and sh.user_id=auth.uid() and sh.role='editor')))
$$;
create function public.owns_set(target uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.study_sets s where s.id=target and s.owner_id=auth.uid())
$$;

alter table public.profiles enable row level security;
alter table public.folders enable row level security;
alter table public.study_sets enable row level security;
alter table public.flashcards enable row level security;
alter table public.set_shares enable row level security;
alter table public.card_progress enable row level security;
alter table public.review_logs enable row level security;
alter table public.study_sessions enable row level security;

create policy profile_select on public.profiles for select to authenticated using (id=auth.uid());
create policy profile_insert on public.profiles for insert to authenticated with check (id=auth.uid());
create policy profile_update on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy folders_all on public.folders for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy sets_select on public.study_sets for select to authenticated using (public.can_view_set(id));
create policy sets_insert on public.study_sets for insert to authenticated with check (owner_id=auth.uid() and (folder_id is null or exists(select 1 from public.folders f where f.id=folder_id and f.owner_id=auth.uid())));
create policy sets_update on public.study_sets for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid() and (folder_id is null or exists(select 1 from public.folders f where f.id=folder_id and f.owner_id=auth.uid())));
create policy sets_delete on public.study_sets for delete to authenticated using (owner_id=auth.uid());
create policy cards_select on public.flashcards for select to authenticated using (public.can_view_set(set_id));
create policy cards_insert on public.flashcards for insert to authenticated with check (public.can_edit_cards(set_id));
create policy cards_update on public.flashcards for update to authenticated using (public.can_edit_cards(set_id)) with check (public.can_edit_cards(set_id));
create policy cards_delete on public.flashcards for delete to authenticated using (public.can_edit_cards(set_id));
create policy shares_select on public.set_shares for select to authenticated using (user_id=auth.uid() or public.owns_set(set_id));
create policy shares_insert on public.set_shares for insert to authenticated with check (public.owns_set(set_id));
create policy shares_update on public.set_shares for update to authenticated using (public.owns_set(set_id));
create policy shares_delete on public.set_shares for delete to authenticated using (public.owns_set(set_id));
create policy progress_all on public.card_progress for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and exists(select 1 from public.flashcards c where c.id=card_id));
create policy logs_all on public.review_logs for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy sessions_all on public.study_sessions for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

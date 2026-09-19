-- TechHelp — base de données persistante
-- À exécuter dans Supabase SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  bio text default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  title text not null,
  body text not null,
  image_url text,
  solved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  info text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null default 'activity',
  content text not null,
  created_at timestamptz not null default now()
);

-- RLS : chaque utilisateur gère ses propres données ; les posts/commentaires sont lisibles par la communauté.
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.user_devices enable row level security;
alter table public.user_memory enable row level security;

create policy "profiles readable" on public.profiles for select using (true);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

create policy "posts readable" on public.posts for select using (true);
create policy "own posts insert" on public.posts for insert with check (auth.uid() = user_id);
create policy "own posts update" on public.posts for update using (auth.uid() = user_id);
delete policy if exists "own posts delete" on public.posts;
create policy "own posts delete" on public.posts for delete using (auth.uid() = user_id);

create policy "comments readable" on public.comments for select using (true);
create policy "own comments insert" on public.comments for insert with check (auth.uid() = user_id);
create policy "own comments delete" on public.comments for delete using (auth.uid() = user_id);

create policy "likes readable" on public.post_likes for select using (true);
create policy "own likes insert" on public.post_likes for insert with check (auth.uid() = user_id);
create policy "own likes delete" on public.post_likes for delete using (auth.uid() = user_id);

create policy "own devices" on public.user_devices for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own memory" on public.user_memory for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Temps réel
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.post_likes;

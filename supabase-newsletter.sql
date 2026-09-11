-- ============================================================
-- IA DÉRAPE — Newsletter
-- À exécuter dans Supabase → SQL Editor (bouton RUN)
-- ============================================================

-- 1. La table des abonnés -------------------------------------
create table if not exists public.newsletter (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  source      text default 'site',
  confirmed   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists newsletter_email_idx on public.newsletter (lower(email));

-- RLS : le site peut SEULEMENT insérer son email.
alter table public.newsletter enable row level security;

drop policy if exists "newsletter_public_insert" on public.newsletter;
create policy "newsletter_public_insert"
  on public.newsletter
  for insert
  to anon, authenticated
  with check (true);

-- Aucune policy SELECT → la liste des emails n'est PAS exposée au public.


-- 2. Suivi des envois -----------------------------------------
create table if not exists public.newsletter_sent (
  news_id     text primary key,
  sent_at     timestamptz not null default now(),
  recipients  integer default 0
);

alter table public.newsletter_sent enable row level security;


-- 3. Vue publique : le NOMBRE d'abonnés uniquement -------------
-- Expose juste des compteurs, jamais les adresses email.
-- SECURITY DEFINER = contourne le RLS pour compter, mais ne
-- renvoie que des chiffres : aucune donnée personnelle ne fuit.
create or replace view public.newsletter_stats
with (security_invoker = off)
as
select
  count(*)                                                        as total,
  count(*) filter (where created_at > now() - interval '7 days')  as cette_semaine,
  count(*) filter (where created_at > now() - interval '1 day')   as aujourdhui
from public.newsletter;

-- Le rôle anonyme (le site) peut lire cette vue.
grant select on public.newsletter_stats to anon, authenticated;

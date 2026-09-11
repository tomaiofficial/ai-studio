-- ============================================================
-- IA DÉRAPE — Newsletter
-- À exécuter dans Supabase → SQL Editor
-- ============================================================

create table if not exists public.newsletter (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  source      text default 'site',
  confirmed   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists newsletter_email_idx on public.newsletter (lower(email));

-- ------------------------------------------------------------
-- Sécurité (RLS) : le site peut SEULEMENT insérer son email.
-- Personne ne peut lire la liste depuis le navigateur.
-- ------------------------------------------------------------
alter table public.newsletter enable row level security;

-- Autorise l'inscription publique (insertion seule)
drop policy if exists "newsletter_public_insert" on public.newsletter;
create policy "newsletter_public_insert"
  on public.newsletter
  for insert
  to anon, authenticated
  with check (true);

-- Aucune policy SELECT → la liste n'est pas exposée au public.
-- Toi, tu la vois depuis le dashboard Supabase (rôle service_role).

-- ------------------------------------------------------------
-- Suivi des envois : savoir quelle actu a déjà été notifiée
-- ------------------------------------------------------------
create table if not exists public.newsletter_sent (
  news_id     text primary key,
  sent_at     timestamptz not null default now(),
  recipients  integer default 0
);

alter table public.newsletter_sent enable row level security;
-- Pas de policy → accessible uniquement via service_role (GitHub Action).

-- ------------------------------------------------------------
-- Vue pratique (optionnel) : compter les abonnés
-- ------------------------------------------------------------
create or replace view public.newsletter_stats as
select
  count(*)                                              as total,
  count(*) filter (where created_at > now() - interval '7 days')  as cette_semaine,
  count(*) filter (where created_at > now() - interval '1 day')   as aujourdhui
from public.newsletter;

-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- The app talks to these tables only through its backend (service key), so RLS stays on
-- with no public policies: the anon key can't touch anything.

create table if not exists kv_docs (
  path text primary key,
  collection text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists kv_docs_collection on kv_docs (collection);

create table if not exists sessions (
  sid text primary key,
  uid text,
  name text,
  access text not null,
  refresh text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  uid text primary key,
  name text
);

alter table kv_docs enable row level security;
alter table sessions enable row level security;
alter table users enable row level security;

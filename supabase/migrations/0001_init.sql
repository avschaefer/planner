-- Planner: one row per schedule.
--
-- The shape mirrors ProjectDoc in src/engine/types.ts exactly. The app's unit
-- of persistence has always been the whole document — the store clones it,
-- mutates it, reschedules and writes it back, and undo is a stack of whole
-- documents (EDD D-008) — so tasks and links are jsonb rather than child
-- tables. Normalising here would mean rewriting the store, not the schema.

create table if not exists public.projects (
  id          text primary key,                                   -- ProjectDoc.id
  name        text not null,                                      -- ProjectDoc.name
  data_date   date not null,                                      -- ProjectDoc.dataDate
  tasks       jsonb not null default '[]'::jsonb,                  -- Task[]
  links       jsonb not null default '[]'::jsonb,                  -- Link[]
  updated_at  timestamptz not null default now(),                  -- ProjectDoc.updatedAt

  -- Which browser wrote last. A realtime event carrying your own client id is
  -- your own echo, and is ignored rather than re-applied.
  client_id   text,

  -- The soft editor lock (PRD Q-6). Claimed on first edit, kept alive by a
  -- heartbeat, and considered abandoned 90s after the last one. There is no
  -- explicit release, because a closed laptop never sends one.
  editor_id   text,
  editor_seen timestamptz,

  -- So the project list can be built without pulling every task down.
  task_count  int generated always as (jsonb_array_length(tasks)) stored
);

create index if not exists projects_updated_at_idx on public.projects (updated_at desc);

alter table public.projects enable row level security;

-- Read-only for the anon key, which is what makes Realtime work in the
-- browser. There is deliberately no insert/update/delete policy: writes
-- arrive only through the service role, from api/save.ts and api/delete.ts,
-- behind the passcode. A leaked anon key can read, never corrupt.
drop policy if exists projects_read_anon on public.projects;
create policy projects_read_anon on public.projects
  for select to anon, authenticated using (true);

-- Broadcast row changes to subscribed clients.
alter publication supabase_realtime add table public.projects;

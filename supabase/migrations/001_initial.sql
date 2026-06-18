-- Smile Battle 1v1 schema

create table lobbies (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'countdown', 'active', 'finished')),
  host_player_id text not null,
  countdown_starts_at timestamptz,
  started_at timestamptz,
  created_at timestamptz not null default now()
);

create table lobby_players (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references lobbies(id) on delete cascade,
  player_id text not null,
  display_name text not null,
  slot smallint not null check (slot in (1, 2)),
  is_ready boolean not null default false,
  smile_score real not null default 0,
  created_at timestamptz not null default now(),
  unique (lobby_id, player_id),
  unique (lobby_id, slot)
);

create index lobby_players_lobby_id_idx on lobby_players (lobby_id);
create index lobbies_code_idx on lobbies (code);

alter table lobbies enable row level security;
alter table lobby_players enable row level security;

create policy "lobbies_select" on lobbies for select using (true);
create policy "lobbies_insert" on lobbies for insert with check (true);
create policy "lobbies_update" on lobbies for update using (true);

create policy "lobby_players_select" on lobby_players for select using (true);
create policy "lobby_players_insert" on lobby_players for insert with check (true);
create policy "lobby_players_update" on lobby_players for update using (true);
create policy "lobby_players_delete" on lobby_players for delete using (true);

alter publication supabase_realtime add table lobbies;
alter publication supabase_realtime add table lobby_players;

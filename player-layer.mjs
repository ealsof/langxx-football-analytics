import Database from "better-sqlite3";

const db = new Database("./football.db");

db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_team_id TEXT NOT NULL,
  name TEXT NOT NULL,
  competition TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_team_id)
);

CREATE TABLE IF NOT EXISTS team_sources (
  team_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_team_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(provider, provider_team_id),
  FOREIGN KEY(team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  team_id INTEGER,
  position TEXT,
  date_of_birth TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_player_id),
  FOREIGN KEY(team_id) REFERENCES teams(id)
);

CREATE TABLE IF NOT EXISTS player_match_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  minutes INTEGER DEFAULT 0,
  started INTEGER DEFAULT 0,
  position TEXT,
  goals INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  shots INTEGER DEFAULT 0,
  key_passes INTEGER DEFAULT 0,
  rating REAL,
  yellow_cards INTEGER DEFAULT 0,
  red_cards INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(player_id, match_id),
  FOREIGN KEY(player_id) REFERENCES players(id),
  FOREIGN KEY(match_id) REFERENCES matches(id)
);

CREATE TABLE IF NOT EXISTS player_availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  match_id INTEGER,
  status TEXT NOT NULL,
  reason TEXT,
  confidence REAL DEFAULT 0.5,
  source TEXT,
  information_cutoff TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(player_id) REFERENCES players(id),
  FOREIGN KEY(match_id) REFERENCES matches(id)
);

CREATE TABLE IF NOT EXISTS lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  starter INTEGER DEFAULT 0,
  position TEXT,
  formation_position TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(match_id, player_id),
  FOREIGN KEY(match_id) REFERENCES matches(id),
  FOREIGN KEY(team_id) REFERENCES teams(id),
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS player_context_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT,
  information_cutoff TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  impact_direction TEXT DEFAULT 'neutral',
  created_at TEXT NOT NULL,
  FOREIGN KEY(player_id) REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_players_team
ON players(team_id);

CREATE INDEX IF NOT EXISTS idx_player_stats_match
ON player_match_stats(match_id);

CREATE INDEX IF NOT EXISTS idx_player_stats_player
ON player_match_stats(player_id);

CREATE INDEX IF NOT EXISTS idx_availability_player
ON player_availability(player_id);

CREATE INDEX IF NOT EXISTS idx_availability_match
ON player_availability(match_id);

CREATE INDEX IF NOT EXISTS idx_lineups_match
ON lineups(match_id);
`);

console.log("Player Intelligence Layer berhasil dibuat.");

const tables = db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
  AND name IN (
    'teams',
    'team_sources',
    'players',
    'player_match_stats',
    'player_availability',
    'lineups',
    'player_context_events'
  )
  ORDER BY name
`).all();

console.table(tables);

db.close();
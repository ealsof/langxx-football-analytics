import Database from "better-sqlite3";

const db = new Database("./football.db");

console.log("\n=== TEAM ALIASES ===");

const aliases = db.prepare(`
  SELECT
    team_id,
    alias,
    competition
  FROM team_aliases
  ORDER BY competition, alias
`).all();

console.table(aliases);

console.log("\n=== MATCH SAMPLE ===");

const matches = db.prepare(`
  SELECT
    home_team,
    away_team,
    competition
  FROM matches
  WHERE home_team IN (
    'Arsenal',
    'Chelsea',
    'Liverpool',
    'Manchester United',
    'Barcelona',
    'Real Madrid'
  )
  OR away_team IN (
    'Arsenal',
    'Chelsea',
    'Liverpool',
    'Manchester United',
    'Barcelona',
    'Real Madrid'
  )
  LIMIT 20
`).all();

console.table(matches);

db.close();
import Database from "better-sqlite3";

const db = new Database("./football.db");

console.log("=== CURRENT TEAM SOURCES ===");

const rows = db.prepare(`
  SELECT
    ts.team_id,
    t.name,
    t.competition,
    ts.provider,
    ts.provider_team_id
  FROM team_sources ts
  JOIN teams t
    ON t.id = ts.team_id
  ORDER BY t.competition, t.name
`).all();

console.table(rows);

console.log("\n=== COUNT ===");

const count = db.prepare(`
  SELECT COUNT(*) AS total
  FROM team_sources
`).get();

console.table([count]);

db.close();
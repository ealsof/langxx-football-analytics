import Database from "better-sqlite3";

const db = new Database("./football.db");

console.log("=== STRUKTUR MATCHES ===");

const columns = db.prepare(`
  PRAGMA table_info(matches)
`).all();

console.table(
  columns.map(c => ({
    column: c.name,
    type: c.type
  }))
);

console.log("\n=== RENTANG TANGGAL MATCH ===");

const range = db.prepare(`
  SELECT
    MIN(kickoff) AS earliest,
    MAX(kickoff) AS latest,
    COUNT(*) AS total
  FROM matches
`).get();

console.table([range]);

console.log("\n=== PER BULAN ===");

const monthly = db.prepare(`
  SELECT
    substr(kickoff, 1, 7) AS month,
    competition,
    COUNT(*) AS matches
  FROM matches
  GROUP BY month, competition
  ORDER BY month, competition
`).all();

console.table(monthly);

console.log("\n=== TIM PREMIER LEAGUE ===");

const plTeams = db.prepare(`
  SELECT
    home_team AS team,
    home_team_id AS team_id,
    COUNT(*) AS home_matches
  FROM matches
  WHERE competition = 'Premier League'

  GROUP BY home_team, home_team_id

  ORDER BY team
`).all();

console.table(plTeams);

console.log("\n=== TIM LA LIGA ===");

const laLigaTeams = db.prepare(`
  SELECT
    home_team AS team,
    home_team_id AS team_id,
    COUNT(*) AS home_matches
  FROM matches
  WHERE competition = 'La Liga'

  GROUP BY home_team, home_team_id

  ORDER BY team
`).all();

console.table(laLigaTeams);

db.close();
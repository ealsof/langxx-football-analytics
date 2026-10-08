import Database from "better-sqlite3";

const db = new Database("./football.db", {
  readonly: true
});

console.log("========================================");
console.log("CEK DATABASE FOOTBALL ANALYTICS");
console.log("========================================");
console.log("");

const total = db.prepare(`
  SELECT COUNT(*) AS total
  FROM matches
`).get();

console.log("Total rows matches :", total.total);
console.log("");

const statuses = db.prepare(`
  SELECT
    status,
    COUNT(*) AS total
  FROM matches
  GROUP BY status
  ORDER BY total DESC
`).all();

console.log("STATUS MATCH:");
console.table(statuses);
console.log("");

const finished = db.prepare(`
  SELECT COUNT(*) AS total
  FROM matches
  WHERE status = 'FINISHED'
`).get();

console.log("Status FINISHED :", finished.total);
console.log("");

const scored = db.prepare(`
  SELECT COUNT(*) AS total
  FROM matches
  WHERE home_score IS NOT NULL
    AND away_score IS NOT NULL
`).get();

console.log("Match dengan skor :", scored.total);
console.log("");

const sample = db.prepare(`
  SELECT
    id,
    kickoff,
    competition,
    home_team,
    away_team,
    home_score,
    away_score,
    status
  FROM matches
  ORDER BY kickoff ASC
  LIMIT 5
`).all();

console.log("5 DATA PERTAMA:");
console.table(sample);

console.log("");
console.log("========================================");
console.log("CEK SELESAI");
console.log("========================================");

db.close();
import Database from "better-sqlite3";

const db = new Database("./football.db");

db.pragma("foreign_keys = ON");

const mappings = [
  { from: 3,  to: 2,  name: "Arsenal" },
  { from: 18, to: 6,  name: "Barcelona" },
  { from: 11, to: 10, name: "Chelsea" },
  { from: 26, to: 25, name: "Liverpool" },
  { from: 29, to: 28, name: "Manchester United" },
  { from: 39, to: 38, name: "Real Madrid" }
];

const update = db.prepare(`
  UPDATE team_sources
  SET team_id = ?
  WHERE team_id = ?
    AND provider = 'football-data.org'
`);

const transaction = db.transaction(() => {

  for (const item of mappings) {

    const result = update.run(
      item.to,
      item.from
    );

    console.log(
      `${item.name}: ${item.from} -> ${item.to} | ` +
      `updated ${result.changes} row`
    );
  }
});

transaction();

console.log("\n=== RESULT ===");

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
  WHERE ts.provider = 'football-data.org'
  ORDER BY t.competition, t.name
`).all();

console.table(rows);

db.close();
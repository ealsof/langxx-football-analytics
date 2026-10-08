import Database from "better-sqlite3";

const db = new Database("./football.db");

db.pragma("foreign_keys = ON");

console.log("=== MIGRASI TEAM ID ===");

//
// 1. Tambahkan kolom home_team_id dan away_team_id
//

const columns = db.prepare(`
  PRAGMA table_info(matches)
`).all();

const columnNames = columns.map(c => c.name);

if (!columnNames.includes("home_team_id")) {
  db.exec(`
    ALTER TABLE matches
    ADD COLUMN home_team_id INTEGER
  `);

  console.log("Kolom home_team_id ditambahkan.");
} else {
  console.log("Kolom home_team_id sudah ada.");
}

if (!columnNames.includes("away_team_id")) {
  db.exec(`
    ALTER TABLE matches
    ADD COLUMN away_team_id INTEGER
  `);

  console.log("Kolom away_team_id ditambahkan.");
} else {
  console.log("Kolom away_team_id sudah ada.");
}

//
// 2. Fungsi mencari team_id
//

function findTeamId(teamName, competition) {
  // Cari canonical name
  const direct = db.prepare(`
    SELECT id
    FROM teams
    WHERE name = ?
      AND competition = ?
    LIMIT 1
  `).get(teamName, competition);

  if (direct) {
    return direct.id;
  }

  // Kalau tidak ketemu, cari melalui alias
  const alias = db.prepare(`
    SELECT team_id
    FROM team_aliases
    WHERE alias = ?
      AND competition = ?
    LIMIT 1
  `).get(teamName, competition);

  if (alias) {
    return alias.team_id;
  }

  return null;
}

//
// 3. Update seluruh matches
//

const matches = db.prepare(`
  SELECT
    id,
    home_team,
    away_team,
    competition
  FROM matches
`).all();

const updateMatch = db.prepare(`
  UPDATE matches
  SET
    home_team_id = ?,
    away_team_id = ?,
    updated_at = ?
  WHERE id = ?
`);

let success = 0;
let failed = 0;

const transaction = db.transaction(() => {

  for (const match of matches) {

    const homeTeamId = findTeamId(
      match.home_team,
      match.competition
    );

    const awayTeamId = findTeamId(
      match.away_team,
      match.competition
    );

    if (!homeTeamId || !awayTeamId) {
      failed++;

      console.log(
        `GAGAL: match ${match.id} | ` +
        `${match.home_team} vs ${match.away_team} | ` +
        `${match.competition} | ` +
        `home=${homeTeamId ?? "NULL"} ` +
        `away=${awayTeamId ?? "NULL"}`
      );

      continue;
    }

    updateMatch.run(
      homeTeamId,
      awayTeamId,
      new Date().toISOString(),
      match.id
    );

    success++;
  }

});

transaction();

//
// 4. Hasil
//

console.log("\n=== HASIL MIGRASI ===");

console.log(`Total matches : ${matches.length}`);
console.log(`Berhasil      : ${success}`);
console.log(`Gagal         : ${failed}`);

//
// 5. Audit NULL
//

console.log("\n=== MATCH TANPA TEAM ID ===");

const missing = db.prepare(`
  SELECT
    id,
    home_team,
    away_team,
    competition,
    home_team_id,
    away_team_id
  FROM matches
  WHERE home_team_id IS NULL
     OR away_team_id IS NULL
  ORDER BY competition, kickoff
`).all();

console.table(missing);

//
// 6. Sample
//

console.log("\n=== SAMPLE MATCH + TEAM ID ===");

const sample = db.prepare(`
  SELECT
    id,
    home_team,
    home_team_id,
    away_team,
    away_team_id,
    competition
  FROM matches
  ORDER BY id
  LIMIT 20
`).all();

console.table(sample);

db.close();
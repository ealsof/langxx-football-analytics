import Database from "better-sqlite3";

const db = new Database("./football.db");

db.pragma("foreign_keys = ON");

console.log("=== AUDIT PROTOTYPE MATCHES ===");

const prototypeMatches = db.prepare(`
  SELECT
    id,
    home_team,
    away_team,
    competition,
    kickoff,
    status,
    source
  FROM matches
  WHERE season_id IS NULL
`).all();

console.table(prototypeMatches);

if (prototypeMatches.length === 0) {
  console.log("Tidak ada prototype match.");
  db.close();
  process.exit(0);
}

console.log(
  `\nDitemukan ${prototypeMatches.length} prototype match.`
);

//
// Hapus prediction yang mengacu ke prototype
//

const deleteEvaluations = db.prepare(`
  DELETE FROM evaluations
  WHERE prediction_id IN (
    SELECT id
    FROM predictions
    WHERE match_id = ?
  )
`);

const deletePredictions = db.prepare(`
  DELETE FROM predictions
  WHERE match_id = ?
`);

const deleteSources = db.prepare(`
  DELETE FROM match_sources
  WHERE match_id = ?
`);

const deleteMatches = db.prepare(`
  DELETE FROM matches
  WHERE id = ?
`);

const transaction = db.transaction(() => {

  for (const match of prototypeMatches) {

    console.log(
      `Menghapus prototype: ${match.home_team} vs ${match.away_team}`
    );

    deleteEvaluations.run(match.id);
    deletePredictions.run(match.id);
    deleteSources.run(match.id);
    deleteMatches.run(match.id);
  }

});

transaction();

console.log("\n=== VERIFIKASI ===");

const remaining = db.prepare(`
  SELECT COUNT(*) AS count
  FROM matches
  WHERE season_id IS NULL
`).get();

const total = db.prepare(`
  SELECT COUNT(*) AS count
  FROM matches
`).get();

console.log(`Prototype tersisa : ${remaining.count}`);
console.log(`Total matches      : ${total.count}`);

db.close();
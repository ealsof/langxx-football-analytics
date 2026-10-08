import Database from "better-sqlite3";

const db = new Database(
  "football.db",
  {
    readonly: true,
    fileMustExist: true
  }
);

console.log("\n============================================================");
console.log("FUTURE SCORE LEAKAGE — EXACT ROW");
console.log("============================================================\n");

const rows = db.prepare(`
  SELECT
    id,
    competition,
    kickoff,
    status,
    home_team,
    away_team,
    home_score,
    away_score
  FROM matches
  WHERE LOWER(status) IN ('scheduled', 'timed')
    AND (
      home_score IS NOT NULL
      OR away_score IS NOT NULL
    )
  ORDER BY kickoff ASC
`).all();

console.log(`Jumlah anomali: ${rows.length}\n`);

for (const row of rows) {
  console.log(JSON.stringify(row, null, 2));
}

console.log("\n============================================================");
console.log("MATCH SOURCE / RELATED DATA");
console.log("============================================================\n");

for (const row of rows) {
  console.log(`\nMATCH ID: ${row.id}`);

  const sources = db.prepare(`
    SELECT *
    FROM match_sources
    WHERE match_id = ?
  `).all(row.id);

  console.log(
    "match_sources:",
    JSON.stringify(
      sources,
      null,
      2
    )
  );
}

db.close();

console.log("\n============================================================");
console.log("DIAGNOSTIC COMPLETE");
console.log("DATABASE: READ ONLY");
console.log("NO DATA MODIFIED");
console.log("============================================================");
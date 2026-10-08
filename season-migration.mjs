import Database from "better-sqlite3";
import "dotenv/config";

const db = new Database("./football.db");

db.pragma("foreign_keys = ON");

const token = process.env.FOOTBALL_DATA_API_TOKEN;

if (!token) {
  throw new Error("FOOTBALL_DATA_API_TOKEN tidak ditemukan di .env");
}

console.log("=== SEASON MIGRATION ===");

//
// 1. Tambahkan kolom season
//

const columns = db.prepare(`
  PRAGMA table_info(matches)
`).all();

const columnNames = columns.map(c => c.name);

if (!columnNames.includes("season_id")) {
  db.exec(`
    ALTER TABLE matches
    ADD COLUMN season_id INTEGER
  `);

  console.log("Kolom season_id ditambahkan.");
}

if (!columnNames.includes("season_name")) {
  db.exec(`
    ALTER TABLE matches
    ADD COLUMN season_name TEXT
  `);

  console.log("Kolom season_name ditambahkan.");
}

if (!columnNames.includes("season_start")) {
  db.exec(`
    ALTER TABLE matches
    ADD COLUMN season_start TEXT
  `);

  console.log("Kolom season_start ditambahkan.");
}

if (!columnNames.includes("season_end")) {
  db.exec(`
    ALTER TABLE matches
    ADD COLUMN season_end TEXT
  `);

  console.log("Kolom season_end ditambahkan.");
}

//
// 2. Pastikan match_sources punya provider match ID
//

const sourceColumns = db.prepare(`
  PRAGMA table_info(match_sources)
`).all();

console.log("\n=== MATCH SOURCES ===");
console.table(sourceColumns.map(c => ({
  column: c.name,
  type: c.type
})));

//
// 3. Ambil data football-data.org
//

const competitions = [
  {
    code: "PL",
    name: "Premier League"
  },
  {
    code: "PD",
    name: "La Liga"
  }
];

const allProviderMatches = [];

for (const competition of competitions) {

  console.log(
    `\nMengambil ${competition.name}...`
  );

  const url =
    `https://api.football-data.org/v4/competitions/${competition.code}/matches`;

  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": token
    }
  });

  if (!response.ok) {
    throw new Error(
      `${competition.name}: HTTP ${response.status}`
    );
  }

  const data = await response.json();

  console.log(
    `${competition.name}: ${data.matches?.length ?? 0} matches`
  );

  for (const match of data.matches ?? []) {

    allProviderMatches.push({
      providerMatchId: String(match.id),
      competition: competition.name,
      seasonId: match.season?.id ?? null,
      seasonStart: match.season?.startDate ?? null,
      seasonEnd: match.season?.endDate ?? null,
      homeTeam: match.homeTeam?.name ?? null,
      awayTeam: match.awayTeam?.name ?? null,
      utcDate: match.utcDate ?? null
    });
  }
}

console.log(
  `\nTotal provider matches: ${allProviderMatches.length}`
);

//
// 4. Update database berdasarkan provider_match_id
//

const update = db.prepare(`
  UPDATE matches
  SET
    season_id = ?,
    season_name = ?,
    season_start = ?,
    season_end = ?,
    updated_at = ?
  WHERE id = ?
`);

const sourceMatches = db.prepare(`
  SELECT
    ms.match_id,
    ms.provider_match_id,
    m.competition,
    m.home_team,
    m.away_team,
    m.kickoff
  FROM match_sources ms
  JOIN matches m
    ON m.id = ms.match_id
  WHERE ms.provider = 'football-data.org'
`).all();

console.log(
  `Database matches dengan football-data.org ID: ${sourceMatches.length}`
);

let updated = 0;
let missingProvider = 0;

const providerMap = new Map(
  allProviderMatches.map(match => [
    `${match.competition}|${match.providerMatchId}`,
    match
  ])
);

const transaction = db.transaction(() => {

  for (const row of sourceMatches) {

    const providerMatch = providerMap.get(
      `${row.competition}|${row.provider_match_id}`
    );

    if (!providerMatch) {
      missingProvider++;
      continue;
    }

    let seasonName = null;

    if (
      providerMatch.seasonStart &&
      providerMatch.seasonEnd
    ) {
      const startYear =
        new Date(providerMatch.seasonStart).getUTCFullYear();

      const endYear =
        new Date(providerMatch.seasonEnd).getUTCFullYear();

      seasonName = `${startYear}/${String(endYear).slice(-2)}`;
    }

    update.run(
      providerMatch.seasonId,
      seasonName,
      providerMatch.seasonStart,
      providerMatch.seasonEnd,
      new Date().toISOString(),
      row.match_id
    );

    updated++;
  }

});

transaction();

//
// 5. Audit
//

console.log("\n=== HASIL MIGRASI ===");

console.log(`Provider matches : ${allProviderMatches.length}`);
console.log(`Database matches : ${sourceMatches.length}`);
console.log(`Updated          : ${updated}`);
console.log(`Provider missing : ${missingProvider}`);

console.log("\n=== SEASON DISTRIBUTION ===");

const distribution = db.prepare(`
  SELECT
    competition,
    season_id,
    season_name,
    season_start,
    season_end,
    COUNT(*) AS matches
  FROM matches
  GROUP BY
    competition,
    season_id,
    season_name,
    season_start,
    season_end
  ORDER BY competition, season_start
`).all();

console.table(distribution);

console.log("\n=== MATCH TANPA SEASON ===");

const missingSeason = db.prepare(`
  SELECT
    id,
    home_team,
    away_team,
    competition,
    kickoff
  FROM matches
  WHERE season_id IS NULL
     OR season_name IS NULL
  ORDER BY competition, kickoff
`).all();

console.table(missingSeason);

console.log("\n=== SAMPLE ===");

const sample = db.prepare(`
  SELECT
    m.id,
    m.home_team,
    m.away_team,
    m.competition,
    m.kickoff,
    m.season_id,
    m.season_name,
    ms.provider_match_id
  FROM matches m
  LEFT JOIN match_sources ms
    ON ms.match_id = m.id
   AND ms.provider = 'football-data.org'
  ORDER BY m.kickoff
  LIMIT 20
`).all();

console.table(sample);

db.close();
import Database from "better-sqlite3";

const db = new Database("./football.db");

console.log("=== PROVIDER TEAM VERIFICATION ===\n");

const expectedCanonical = [
  { id: 2, name: "Arsenal", competition: "Premier League" },
  { id: 6, name: "Barcelona", competition: "La Liga" },
  { id: 10, name: "Chelsea", competition: "Premier League" },
  { id: 25, name: "Liverpool", competition: "Premier League" },
  { id: 28, name: "Manchester United", competition: "Premier League" },
  { id: 38, name: "Real Madrid", competition: "La Liga" }
];

let failed = false;

// 1. Verify canonical teams
console.log("=== CANONICAL TEAM MAPPING ===");

for (const team of expectedCanonical) {

  const row = db.prepare(`
    SELECT
      ts.team_id,
      t.name,
      t.competition,
      ts.provider,
      ts.provider_team_id
    FROM team_sources ts
    JOIN teams t
      ON t.id = ts.team_id
    WHERE ts.team_id = ?
      AND ts.provider = 'football-data.org'
  `).get(team.id);

  if (!row) {
    failed = true;

    console.log(
      `❌ MISSING: ${team.name} (internal ${team.id})`
    );
  } else {
    console.log(
      `✅ ${row.name} -> provider ${row.provider_team_id}`
    );
  }
}

// 2. Count canonical teams
console.log("\n=== CANONICAL TEAM COUNT ===");

const counts = db.prepare(`
  SELECT
    t.competition,
    COUNT(*) AS total
  FROM teams t
  JOIN team_sources ts
    ON ts.team_id = t.id
   AND ts.provider = 'football-data.org'
  WHERE t.id IN (2,6,10,25,28,38)
     OR t.name NOT IN (
       'Arsenal FC',
       'FC Barcelona',
       'Chelsea FC',
       'Liverpool FC',
       'Manchester United FC',
       'Real Madrid CF'
     )
  GROUP BY t.competition
  ORDER BY t.competition
`).all();

console.table(counts);

// 3. Duplicate provider IDs
console.log("\n=== DUPLICATE PROVIDER IDS ===");

const duplicateIds = db.prepare(`
  SELECT
    provider,
    provider_team_id,
    COUNT(*) AS total
  FROM team_sources
  GROUP BY provider, provider_team_id
  HAVING COUNT(*) > 1
`).all();

if (duplicateIds.length > 0) {
  failed = true;
  console.table(duplicateIds);
} else {
  console.log("Tidak ada duplicate provider team ID.");
}

// 4. Check canonical mappings by competition
console.log("\n=== PROVIDER TEAM TOTAL ===");

const providerTotals = db.prepare(`
  SELECT
    t.competition,
    COUNT(*) AS total
  FROM team_sources ts
  JOIN teams t
    ON t.id = ts.team_id
  WHERE ts.provider = 'football-data.org'
  GROUP BY t.competition
  ORDER BY t.competition
`).all();

console.table(providerTotals);

// 5. Final
console.log("\n=== FINAL STATUS ===");

if (failed) {
  console.log("❌ PROVIDER TEAM MAPPING FAILED");
  process.exitCode = 1;
} else {
  console.log("✅ PROVIDER TEAM MAPPING VALID");
}

db.close();
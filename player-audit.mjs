import Database from "better-sqlite3";

const db = new Database("./football.db");

console.log("================================");
console.log("=== PLAYER DATABASE AUDIT ===");
console.log("================================\n");

const total = db.prepare(`
  SELECT COUNT(*) AS count
  FROM players
`).get();

console.log("=== TOTAL PLAYERS ===");
console.table(total);

// --------------------------------------------------
// 1. Provider distribution
// --------------------------------------------------

console.log("\n=== PLAYERS BY PROVIDER ===");

const byProvider = db.prepare(`
  SELECT
    provider,
    COUNT(*) AS players
  FROM players
  GROUP BY provider
  ORDER BY provider
`).all();

console.table(byProvider);

// --------------------------------------------------
// 2. Competition distribution
// --------------------------------------------------

console.log("\n=== PLAYERS BY COMPETITION ===");

const byCompetition = db.prepare(`
  SELECT
    t.competition,
    COUNT(DISTINCT p.id) AS players
  FROM players p
  LEFT JOIN teams t
    ON t.id = p.team_id
  GROUP BY t.competition
  ORDER BY t.competition
`).all();

console.table(byCompetition);

// --------------------------------------------------
// 3. Players without team
// --------------------------------------------------

console.log("\n=== PLAYERS WITHOUT TEAM ===");

const withoutTeam = db.prepare(`
  SELECT
    COUNT(*) AS count
  FROM players
  WHERE team_id IS NULL
`).get();

console.table(withoutTeam);

// --------------------------------------------------
// 4. Players without position
// --------------------------------------------------

console.log("\n=== PLAYERS WITHOUT POSITION ===");

const withoutPosition = db.prepare(`
  SELECT
    COUNT(*) AS count
  FROM players
  WHERE position IS NULL
     OR TRIM(position) = ''
`).get();

console.table(withoutPosition);

// --------------------------------------------------
// 5. Players without DOB
// --------------------------------------------------

console.log("\n=== PLAYERS WITHOUT DATE OF BIRTH ===");

const withoutDOB = db.prepare(`
  SELECT
    COUNT(*) AS count
  FROM players
  WHERE date_of_birth IS NULL
     OR TRIM(date_of_birth) = ''
`).get();

console.table(withoutDOB);

// --------------------------------------------------
// 6. Duplicate provider player IDs
// --------------------------------------------------

console.log("\n=== DUPLICATE PROVIDER PLAYER IDs ===");

const duplicateProviderIds = db.prepare(`
  SELECT
    provider,
    provider_player_id,
    COUNT(*) AS count
  FROM players
  GROUP BY provider, provider_player_id
  HAVING COUNT(*) > 1
  ORDER BY count DESC
`).all();

if (duplicateProviderIds.length === 0) {
  console.log("Tidak ada duplicate provider player ID.");
} else {
  console.table(duplicateProviderIds);
}

// --------------------------------------------------
// 7. Duplicate player names
// --------------------------------------------------

console.log("\n=== DUPLICATE PLAYER NAMES ===");

const duplicateNames = db.prepare(`
  SELECT
    LOWER(TRIM(name)) AS normalized_name,
    COUNT(*) AS count
  FROM players
  GROUP BY LOWER(TRIM(name))
  HAVING COUNT(*) > 1
  ORDER BY count DESC
  LIMIT 30
`).all();

console.table(duplicateNames);

// --------------------------------------------------
// 8. Players connected to duplicate/non-canonical teams
// --------------------------------------------------

console.log("\n=== PLAYERS ON DUPLICATE TEAM RECORDS ===");

const duplicateTeamPlayers = db.prepare(`
  SELECT
    p.id AS player_id,
    p.name AS player,
    t.id AS team_id,
    t.name AS team,
    t.competition
  FROM players p
  JOIN teams t
    ON t.id = p.team_id
  WHERE t.id IN (
    SELECT id
    FROM teams
    WHERE name IN (
      'Arsenal FC',
      'FC Barcelona',
      'Chelsea FC',
      'Liverpool FC',
      'Manchester United FC',
      'Real Madrid CF'
    )
  )
  ORDER BY t.name, p.name
`).all();

if (duplicateTeamPlayers.length === 0) {
  console.log("Tidak ada pemain pada team duplicate yang diketahui.");
} else {
  console.table(duplicateTeamPlayers);
}

// --------------------------------------------------
// 9. Team player counts
// --------------------------------------------------

console.log("\n=== PLAYER COUNT PER TEAM ===");

const teamCounts = db.prepare(`
  SELECT
    t.competition,
    t.id AS team_id,
    t.name AS team,
    COUNT(p.id) AS players
  FROM teams t
  LEFT JOIN players p
    ON p.team_id = t.id
   AND p.provider = 'football-data.org'
  WHERE t.competition IN ('Premier League', 'La Liga')
  GROUP BY t.id, t.name, t.competition
  ORDER BY t.competition, t.name
`).all();

console.table(teamCounts);

// --------------------------------------------------
// 10. Position distribution
// --------------------------------------------------

console.log("\n=== POSITION DISTRIBUTION ===");

const positions = db.prepare(`
  SELECT
    position,
    COUNT(*) AS players
  FROM players
  WHERE provider = 'football-data.org'
  GROUP BY position
  ORDER BY players DESC
`).all();

console.table(positions);

// --------------------------------------------------
// 11. Provider IDs that look suspicious
// --------------------------------------------------

console.log("\n=== INVALID / EMPTY PROVIDER IDs ===");

const invalidProviderIds = db.prepare(`
  SELECT
    id,
    name,
    provider,
    provider_player_id
  FROM players
  WHERE provider_player_id IS NULL
     OR TRIM(provider_player_id) = ''
`).all();

if (invalidProviderIds.length === 0) {
  console.log("Tidak ada provider player ID kosong.");
} else {
  console.table(invalidProviderIds);
}

// --------------------------------------------------
// 12. Sample data
// --------------------------------------------------

console.log("\n=== SAMPLE PLAYERS ===");

const sample = db.prepare(`
  SELECT
    p.id,
    p.provider_player_id,
    p.name,
    p.position,
    p.date_of_birth,
    t.name AS team,
    t.competition
  FROM players p
  LEFT JOIN teams t
    ON t.id = p.team_id
  WHERE p.provider = 'football-data.org'
  ORDER BY RANDOM()
  LIMIT 20
`).all();

console.table(sample);

// --------------------------------------------------
// Final summary
// --------------------------------------------------

const summary = {
  total_players: total.count,
  without_team: withoutTeam.count,
  without_position: withoutPosition.count,
  without_date_of_birth: withoutDOB.count,
  duplicate_provider_ids: duplicateProviderIds.length,
  duplicate_names: duplicateNames.length,
  players_on_known_duplicate_teams: duplicateTeamPlayers.length,
  invalid_provider_ids: invalidProviderIds.length
};

console.log("\n================================");
console.log("=== FINAL AUDIT SUMMARY ===");
console.log("================================");

console.table(summary);

console.log("\n=== END PLAYER DATABASE AUDIT ===");

db.close();
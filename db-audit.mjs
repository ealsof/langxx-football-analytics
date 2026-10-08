import Database from "better-sqlite3";

const db = new Database("./football.db");

console.log("=== TOTAL MATCHES ===");

const total = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN season_id IS NOT NULL THEN 1 ELSE 0 END) AS with_season,
    SUM(CASE WHEN season_id IS NULL THEN 1 ELSE 0 END) AS without_season
  FROM matches
`).get();

console.table([total]);

console.log("\n=== SOURCE DISTRIBUTION ===");

console.table(
  db.prepare(`
    SELECT
      source,
      COUNT(*) AS matches
    FROM matches
    GROUP BY source
  `).all()
);

console.log("\n=== SEASON DISTRIBUTION ===");

console.table(
  db.prepare(`
    SELECT
      competition,
      season_id,
      season_name,
      COUNT(*) AS matches
    FROM matches
    GROUP BY competition, season_id, season_name
    ORDER BY competition
  `).all()
);

console.log("\n=== MATCH ID 1-10 ===");

console.table(
  db.prepare(`
    SELECT
      id,
      home_team,
      away_team,
      competition,
      kickoff,
      season_id,
      season_name,
      source
    FROM matches
    ORDER BY id
    LIMIT 10
  `).all()
);

console.log("\n=== FOOTBALL-DATA.ORG SOURCES ===");

console.table(
  db.prepare(`
    SELECT
      m.id,
      m.home_team,
      m.away_team,
      m.competition,
      ms.provider,
      ms.provider_match_id
    FROM matches m
    LEFT JOIN match_sources ms
      ON ms.match_id = m.id
    WHERE ms.provider = 'football-data.org'
    ORDER BY m.id
    LIMIT 10
  `).all()
);

db.close();
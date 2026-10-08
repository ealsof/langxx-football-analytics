import Database from "better-sqlite3";

const db = new Database("./football.db");

db.pragma("foreign_keys = ON");

const now = new Date().toISOString();

// Ambil semua tim unik dari matches
const matches = db.prepare(`
  SELECT DISTINCT
    home_team AS team,
    competition
  FROM matches

  UNION

  SELECT DISTINCT
    away_team AS team,
    competition
  FROM matches
`).all();

const insertTeam = db.prepare(`
  INSERT INTO teams (
    provider,
    provider_team_id,
    name,
    competition,
    created_at,
    updated_at
  )
  VALUES (
    'football-data.org',
    ?,
    ?,
    ?,
    ?,
    ?
  )
  ON CONFLICT(provider, provider_team_id)
  DO UPDATE SET
    name = excluded.name,
    competition = excluded.competition,
    updated_at = excluded.updated_at
`);

const transaction = db.transaction(() => {
  for (const row of matches) {
    // ID sementara yang stabil berdasarkan nama + kompetisi.
    // Nanti akan kita ganti dengan provider_team_id asli
    // ketika provider player/team sudah kita integrasikan.
    const providerTeamId =
      `${row.competition}:${row.team}`
        .toLowerCase()
        .replace(/\s+/g, "_");

    insertTeam.run(
      providerTeamId,
      row.team,
      row.competition,
      now,
      now
    );
  }
});

transaction();

const teams = db.prepare(`
  SELECT
    id,
    provider,
    provider_team_id,
    name,
    competition
  FROM teams
  ORDER BY competition, name
`).all();

console.log(`Total tim: ${teams.length}`);
console.table(teams);

db.close();
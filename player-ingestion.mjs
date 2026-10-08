import Database from "better-sqlite3";
import "dotenv/config";

const db = new Database("./football.db");

const token = process.env.FOOTBALL_DATA_API_TOKEN;

if (!token) {
  throw new Error("FOOTBALL_DATA_API_TOKEN tidak ditemukan di .env");
}

const provider = "football-data.org";
const headers = {
  "X-Auth-Token": token
};

// Jeda normal antar-request.
// Kita sengaja tidak ngebut supaya API lebih aman.
const REQUEST_DELAY_MS = 6500;

// Maksimal retry ketika terkena 429.
const MAX_RETRIES = 5;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTeams() {
  return db.prepare(`
    SELECT
      t.id AS team_id,
      t.name,
      t.competition,
      ts.provider_team_id
    FROM teams t
    JOIN team_sources ts
      ON ts.team_id = t.id
    WHERE ts.provider = ?
    ORDER BY t.competition, t.name
  `).all(provider);
}

function getExistingPlayerCount(teamId) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM players
    WHERE provider = ?
      AND team_id = ?
  `).get(provider, teamId).count;
}

const upsertPlayer = db.prepare(`
  INSERT INTO players (
    provider,
    provider_player_id,
    name,
    team_id,
    position,
    date_of_birth,
    created_at,
    updated_at
  )
  VALUES (
    @provider,
    @provider_player_id,
    @name,
    @team_id,
    @position,
    @date_of_birth,
    @created_at,
    @updated_at
  )
  ON CONFLICT(provider, provider_player_id)
  DO UPDATE SET
    name = excluded.name,
    team_id = excluded.team_id,
    position = excluded.position,
    date_of_birth = excluded.date_of_birth,
    updated_at = excluded.updated_at
`);

async function fetchTeamSquad(team) {
  const url =
    `https://api.football-data.org/v4/teams/${team.provider_team_id}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`Request attempt ${attempt}/${MAX_RETRIES}`);

    try {
      const response = await fetch(url, {
        headers
      });

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");

        let waitSeconds = Number(retryAfterHeader);

        if (!Number.isFinite(waitSeconds) || waitSeconds <= 0) {
          const text = await response.text();

          const match = text.match(/Wait\s+(\d+)\s+seconds/i);

          waitSeconds = match
            ? Number(match[1])
            : 60;
        }

        // Tambahan buffer kecil supaya tidak request tepat
        // ketika limit sedang berpindah.
        waitSeconds += 2;

        console.log(
          `HTTP 429 — tunggu ${waitSeconds} detik sebelum retry...`
        );

        await sleep(waitSeconds * 1000);

        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
          `HTTP ${response.status}: ${errorText}`
        );
      }

      return await response.json();

    } catch (error) {
      console.log(`ERROR: ${error.message}`);

      if (attempt === MAX_RETRIES) {
        throw error;
      }

      console.log("Tunggu sebelum mencoba lagi...");
      await sleep(REQUEST_DELAY_MS);
    }
  }

  throw new Error("Gagal mengambil squad.");
}

console.log("=== PLAYER INGESTION V2 ===\n");

const teams = getTeams();

console.log(`Total team terdaftar: ${teams.length}`);

let teamsSkipped = 0;
let teamsSuccess = 0;
let teamsFailed = 0;

let playersInserted = 0;
let playersUpdated = 0;

const failedTeams = [];

for (let index = 0; index < teams.length; index++) {
  const team = teams[index];

  console.log(
    `\n[${index + 1}/${teams.length}] ` +
    `[${team.competition}] ${team.name} ` +
    `| provider ID ${team.provider_team_id}`
  );

  /*
   * RESUME LOGIC
   *
   * Kalau team sudah memiliki player dari provider ini,
   * kita anggap squad team tersebut sudah pernah berhasil
   * di-ingest dan kita skip.
   */
  const existingCount = getExistingPlayerCount(team.team_id);

  if (existingCount > 0) {
    console.log(
      `SKIP — sudah ada ${existingCount} pemain di database.`
    );

    teamsSkipped++;
    continue;
  }

  try {
    const data = await fetchTeamSquad(team);

    const squad = Array.isArray(data.squad)
      ? data.squad
      : [];

    console.log(`Squad ditemukan: ${squad.length}`);

    if (squad.length === 0) {
      console.log(
        "WARNING — squad kosong, team tidak ditandai sukses."
      );

      teamsFailed++;
      failedTeams.push({
        team: team.name,
        competition: team.competition,
        reason: "empty_squad"
      });

      continue;
    }

    const now = new Date().toISOString();

    let inserted = 0;
    let updated = 0;

    const insertMany = db.transaction((players) => {
      for (const player of players) {
        if (!player.id || !player.name) {
          continue;
        }

        const existing = db.prepare(`
          SELECT id
          FROM players
          WHERE provider = ?
            AND provider_player_id = ?
        `).get(
          provider,
          String(player.id)
        );

        upsertPlayer.run({
          provider,
          provider_player_id: String(player.id),
          name: player.name,
          team_id: team.team_id,
          position: player.position ?? null,
          date_of_birth: player.dateOfBirth ?? null,
          created_at: now,
          updated_at: now
        });

        if (existing) {
          updated++;
        } else {
          inserted++;
        }
      }
    });

    insertMany(squad);

    playersInserted += inserted;
    playersUpdated += updated;

    teamsSuccess++;

    console.log(
      `SUCCESS — inserted: ${inserted}, updated: ${updated}`
    );

  } catch (error) {
    teamsFailed++;

    failedTeams.push({
      team: team.name,
      competition: team.competition,
      reason: error.message
    });

    console.log(`FAILED — ${error.message}`);
  }

  /*
   * Jeda antar team.
   */
  if (index < teams.length - 1) {
    console.log(
      `Menunggu ${REQUEST_DELAY_MS / 1000} detik...`
    );

    await sleep(REQUEST_DELAY_MS);
  }
}

console.log("\n================================");
console.log("=== PLAYER INGESTION RESULT ===");
console.log("================================");

console.log({
  teams_total: teams.length,
  teams_skipped: teamsSkipped,
  teams_success: teamsSuccess,
  teams_failed: teamsFailed,
  players_inserted: playersInserted,
  players_updated: playersUpdated
});

console.log("\n=== FAILED TEAMS ===");

if (failedTeams.length === 0) {
  console.log("Tidak ada team gagal.");
} else {
  console.table(failedTeams);
}

const totalPlayers = db.prepare(`
  SELECT COUNT(*) AS count
  FROM players
  WHERE provider = ?
`).get(provider);

console.log("\n=== TOTAL PLAYERS ===");
console.table(totalPlayers);

const playersByCompetition = db.prepare(`
  SELECT
    t.competition,
    COUNT(DISTINCT p.id) AS players
  FROM players p
  JOIN teams t
    ON t.id = p.team_id
  WHERE p.provider = ?
  GROUP BY t.competition
  ORDER BY t.competition
`).all(provider);

console.log("\n=== PLAYERS BY COMPETITION ===");
console.table(playersByCompetition);

console.log("\n=== END PLAYER INGESTION V2 ===");

db.close();
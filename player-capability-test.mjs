import Database from "better-sqlite3";
import "dotenv/config";

const db = new Database("./football.db");

const token = process.env.FOOTBALL_DATA_API_TOKEN;

if (!token) {
  throw new Error("FOOTBALL_DATA_API_TOKEN tidak ditemukan.");
}

const headers = {
  "X-Auth-Token": token
};

// Ambil satu tim canonical yang sudah punya provider ID.
const team = db.prepare(`
  SELECT
    ts.team_id,
    ts.provider_team_id,
    t.name,
    t.competition
  FROM team_sources ts
  JOIN teams t
    ON t.id = ts.team_id
  WHERE ts.provider = 'football-data.org'
  ORDER BY t.competition, t.name
  LIMIT 1
`).get();

if (!team) {
  throw new Error("Tidak menemukan provider team mapping.");
}

console.log("=== PLAYER CAPABILITY TEST ===\n");

console.log("Test team:");
console.table([team]);

async function request(name, url) {

  console.log(`\n=== ${name} ===`);
  console.log(url);

  try {

    const response = await fetch(url, {
      headers
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }

    console.log(`HTTP: ${response.status}`);
    console.log(`OK  : ${response.ok}`);

    if (!data) {
      console.log("Response bukan JSON.");
      return null;
    }

    if (data.message) {
      console.log(`Message: ${data.message}`);
    }

    return data;

  } catch (error) {

    console.log(`ERROR: ${error.message}`);
    return null;

  }
}

// 1. TEAM SQUAD
const teamData = await request(
  "TEAM SQUAD",
  `https://api.football-data.org/v4/teams/${team.provider_team_id}`
);

if (teamData) {

  console.log(
    `Squad count: ${teamData.squad?.length ?? 0}`
  );

  if (teamData.squad?.length) {

    console.log("\nContoh pemain:");

    console.table(
      teamData.squad.slice(0, 5).map(player => ({
        id: player.id,
        name: player.name,
        position: player.position,
        dateOfBirth: player.dateOfBirth,
        nationality: player.nationality,
        role: player.role
      }))
    );
  }
}

// 2. CARI SATU MATCH FINISHED
const match = db.prepare(`
  SELECT
    ms.provider_match_id,
    m.id,
    m.home_team,
    m.away_team,
    m.kickoff
  FROM match_sources ms
  JOIN matches m
    ON m.id = ms.match_id
  WHERE ms.provider = 'football-data.org'
    AND m.status = 'finished'
  ORDER BY m.kickoff DESC
  LIMIT 1
`).get();

if (!match) {
  throw new Error("Tidak menemukan finished match.");
}

console.log("\n=== TEST MATCH ===");
console.table([match]);

// 3. MATCH DETAIL
const matchData = await request(
  "MATCH DETAIL",
  `https://api.football-data.org/v4/matches/${match.provider_match_id}`
);

if (matchData) {

  console.log("\nMATCH DETAIL STRUCTURE:");

  console.log({
    homeLineup: matchData.homeTeam?.lineup?.length ?? 0,
    homeBench: matchData.homeTeam?.bench?.length ?? 0,
    awayLineup: matchData.awayTeam?.lineup?.length ?? 0,
    awayBench: matchData.awayTeam?.bench?.length ?? 0,
    goals: matchData.goals?.length ?? 0,
    bookings: matchData.bookings?.length ?? 0,
    substitutions: matchData.substitutions?.length ?? 0
  });

  if (matchData.homeTeam?.lineup?.length) {

    console.log("\nContoh HOME LINEUP:");

    console.table(
      matchData.homeTeam.lineup.slice(0, 5)
    );
  }

  if (matchData.goals?.length) {

    console.log("\nContoh GOALS:");

    console.table(
      matchData.goals.slice(0, 5).map(goal => ({
        minute: goal.minute,
        type: goal.type,
        team: goal.team?.name,
        scorer: goal.scorer?.name,
        assist: goal.assist?.name ?? null
      }))
    );
  }

  if (matchData.substitutions?.length) {

    console.log("\nContoh SUBSTITUTIONS:");

    console.table(
      matchData.substitutions.slice(0, 5).map(sub => ({
        minute: sub.minute,
        team: sub.team?.name,
        playerOut: sub.playerOut?.name,
        playerIn: sub.playerIn?.name
      }))
    );
  }
}

// 4. PERSON MATCH TEST
const samplePlayer =
  teamData?.squad?.find(player => player.id)?.id;

if (samplePlayer) {

  const personData = await request(
    "PERSON MATCHES",
    `https://api.football-data.org/v4/persons/${samplePlayer}/matches?limit=5`
  );

  if (personData) {

    console.log("\nPLAYER AGGREGATIONS:");

    console.log(
      personData.aggregations ?? "Tidak tersedia"
    );
  }
}

console.log("\n=== END PLAYER CAPABILITY TEST ===");

db.close();
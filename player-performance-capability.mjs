import Database from "better-sqlite3";
import "dotenv/config";

const db = new Database("./football.db");

const token = process.env.FOOTBALL_DATA_API_TOKEN;

if (!token) {
  throw new Error("FOOTBALL_DATA_API_TOKEN tidak ditemukan di .env");
}

const headers = {
  "X-Auth-Token": token
};

const provider = "football-data.org";

console.log("================================");
console.log("=== PLAYER PERFORMANCE TEST ===");
console.log("================================");

// Ambil pertandingan finished terbaru
const match = db.prepare(`
  SELECT
    ms.provider_match_id,
    m.id,
    m.home_team,
    m.away_team,
    m.kickoff,
    m.status
  FROM match_sources ms
  JOIN matches m
    ON m.id = ms.match_id
  WHERE ms.provider = ?
    AND m.status = 'finished'
  ORDER BY m.kickoff DESC
  LIMIT 1
`).get(provider);

if (!match) {
  throw new Error("Tidak menemukan finished match.");
}

console.log("\n=== TEST MATCH ===");
console.table([match]);

const url =
  `https://api.football-data.org/v4/matches/${match.provider_match_id}`;

console.log("\nRequest:");
console.log(url);

const response = await fetch(url, {
  headers
});

console.log(`HTTP: ${response.status}`);
console.log(`OK  : ${response.ok}`);

const text = await response.text();

let data;

try {
  data = JSON.parse(text);
} catch {
  console.log("Response bukan JSON.");
  db.close();
  process.exit(1);
}

if (!response.ok) {
  console.log(data);
  db.close();
  process.exit(1);
}

// --------------------------------------------------
// BASIC MATCH STRUCTURE
// --------------------------------------------------

console.log("\n=== MATCH OBJECT KEYS ===");
console.log(Object.keys(data));

console.log("\n=== HOME TEAM KEYS ===");
console.log(Object.keys(data.homeTeam ?? {}));

console.log("\n=== AWAY TEAM KEYS ===");
console.log(Object.keys(data.awayTeam ?? {}));

// --------------------------------------------------
// LINEUP
// --------------------------------------------------

console.log("\n=== LINEUP CHECK ===");

console.log({
  homeLineup: data.homeTeam?.lineup?.length ?? 0,
  homeBench: data.homeTeam?.bench?.length ?? 0,
  awayLineup: data.awayTeam?.lineup?.length ?? 0,
  awayBench: data.awayTeam?.bench?.length ?? 0
});

if (data.homeTeam?.lineup?.length) {
  console.log("\nHOME LINEUP SAMPLE:");
  console.dir(data.homeTeam.lineup.slice(0, 5), {
    depth: null
  });
}

if (data.awayTeam?.lineup?.length) {
  console.log("\nAWAY LINEUP SAMPLE:");
  console.dir(data.awayTeam.lineup.slice(0, 5), {
    depth: null
  });
}

// --------------------------------------------------
// MATCH EVENTS
// --------------------------------------------------

console.log("\n=== GOALS ===");

console.log(
  `Goals: ${data.goals?.length ?? 0}`
);

if (data.goals?.length) {
  console.dir(data.goals.slice(0, 10), {
    depth: null
  });
}

console.log("\n=== BOOKINGS ===");

console.log(
  `Bookings: ${data.bookings?.length ?? 0}`
);

if (data.bookings?.length) {
  console.dir(data.bookings.slice(0, 10), {
    depth: null
  });
}

console.log("\n=== SUBSTITUTIONS ===");

console.log(
  `Substitutions: ${data.substitutions?.length ?? 0}`
);

if (data.substitutions?.length) {
  console.dir(data.substitutions.slice(0, 10), {
    depth: null
  });
}

// --------------------------------------------------
// RAW STRUCTURE SUMMARY
// --------------------------------------------------

console.log("\n=== AVAILABLE MATCH DATA ===");

const availability = {
  homeTeam: !!data.homeTeam,
  awayTeam: !!data.awayTeam,

  homeLineup:
    Array.isArray(data.homeTeam?.lineup),

  awayLineup:
    Array.isArray(data.awayTeam?.lineup),

  homeBench:
    Array.isArray(data.homeTeam?.bench),

  awayBench:
    Array.isArray(data.awayTeam?.bench),

  goals:
    Array.isArray(data.goals),

  bookings:
    Array.isArray(data.bookings),

  substitutions:
    Array.isArray(data.substitutions),

  score:
    !!data.score,

  referees:
    Array.isArray(data.referees)
};

console.table(availability);

// --------------------------------------------------
// PLAYER IDENTITY CROSS-CHECK
// --------------------------------------------------

console.log("\n=== PLAYER IDENTITY CROSS-CHECK ===");

const players = db.prepare(`
  SELECT
    id,
    provider_player_id,
    name,
    team_id,
    position
  FROM players
  WHERE provider = ?
  ORDER BY RANDOM()
  LIMIT 5
`).all(provider);

console.table(players);

console.log("\n=== END PLAYER PERFORMANCE TEST ===");

db.close();
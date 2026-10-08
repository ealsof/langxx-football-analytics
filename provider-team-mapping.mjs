import Database from "better-sqlite3";
import "dotenv/config";

const db = new Database("./football.db");

db.pragma("foreign_keys = ON");

const token = process.env.FOOTBALL_DATA_API_TOKEN;

if (!token) {
  throw new Error("FOOTBALL_DATA_API_TOKEN tidak ditemukan.");
}

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

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/\b(fc|cf|afc|club|de|fútbol|futbol)\b/g, "")
    .replace(/[^a-z0-9áéíóúüñ\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findInternalTeam(providerName, competition) {

  const direct = db.prepare(`
    SELECT id, name
    FROM teams
    WHERE name = ?
      AND competition = ?
    LIMIT 1
  `).get(providerName, competition);

  if (direct) return direct;

  const alias = db.prepare(`
    SELECT
      t.id,
      t.name
    FROM team_aliases a
    JOIN teams t
      ON t.id = a.team_id
    WHERE a.alias = ?
      AND a.competition = ?
    LIMIT 1
  `).get(providerName, competition);

  if (alias) return alias;

  const candidates = db.prepare(`
    SELECT id, name
    FROM teams
    WHERE competition = ?
  `).all(competition);

  const normalizedProvider = normalize(providerName);

  return candidates.find(
    team => normalize(team.name) === normalizedProvider
  ) ?? null;
}

const insertSource = db.prepare(`
  INSERT OR REPLACE INTO team_sources (
    team_id,
    provider,
    provider_team_id,
    created_at
  )
  VALUES (?, ?, ?, ?)
`);

const now = new Date().toISOString();

let mapped = 0;
let unmatched = 0;

for (const competition of competitions) {

  console.log(`\n=== ${competition.name} ===`);

  const url =
    `https://api.football-data.org/v4/competitions/${competition.code}/teams`;

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
    `Provider teams: ${data.teams?.length ?? 0}`
  );

  for (const providerTeam of data.teams ?? []) {

    const internalTeam = findInternalTeam(
      providerTeam.name,
      competition.name
    );

    if (!internalTeam) {

      unmatched++;

      console.log(
        `UNMATCHED: ${providerTeam.name} | provider ID ${providerTeam.id}`
      );

      continue;
    }

    insertSource.run(
      internalTeam.id,
      "football-data.org",
      String(providerTeam.id),
      now
    );

    mapped++;

    console.log(
      `${providerTeam.name} -> ` +
      `${internalTeam.name} ` +
      `(internal ${internalTeam.id}, provider ${providerTeam.id})`
    );
  }
}

console.log("\n=== HASIL MAPPING ===");

console.log(`Mapped    : ${mapped}`);
console.log(`Unmatched : ${unmatched}`);

console.log("\n=== TEAM SOURCES ===");

const result = db.prepare(`
  SELECT
    ts.team_id,
    t.name,
    t.competition,
    ts.provider,
    ts.provider_team_id
  FROM team_sources ts
  JOIN teams t
    ON t.id = ts.team_id
  ORDER BY t.competition, t.name
`).all();

console.table(result);

db.close();
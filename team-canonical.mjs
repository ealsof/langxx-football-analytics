import Database from "better-sqlite3";

const db = new Database("./football.db");

db.pragma("foreign_keys = ON");

const now = new Date().toISOString();

db.exec(`
CREATE TABLE IF NOT EXISTS team_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  competition TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(alias, competition),
  FOREIGN KEY(team_id) REFERENCES teams(id)
);
`);

const canonicalGroups = [
  {
    competition: "Premier League",
    canonical: "Arsenal",
    aliases: ["Arsenal", "Arsenal FC"]
  },
  {
    competition: "Premier League",
    canonical: "Chelsea",
    aliases: ["Chelsea", "Chelsea FC"]
  },
  {
    competition: "Premier League",
    canonical: "Liverpool",
    aliases: ["Liverpool", "Liverpool FC"]
  },
  {
    competition: "Premier League",
    canonical: "Manchester United",
    aliases: ["Manchester United", "Manchester United FC"]
  },
  {
    competition: "La Liga",
    canonical: "Barcelona",
    aliases: ["Barcelona", "FC Barcelona"]
  },
  {
    competition: "La Liga",
    canonical: "Real Madrid",
    aliases: ["Real Madrid", "Real Madrid CF"]
  }
];

function getTeam(name, competition) {
  return db.prepare(`
    SELECT *
    FROM teams
    WHERE name = ?
      AND competition = ?
    LIMIT 1
  `).get(name, competition);
}

const insertAlias = db.prepare(`
  INSERT OR IGNORE INTO team_aliases (
    team_id,
    alias,
    competition,
    source,
    created_at
  )
  VALUES (?, ?, ?, ?, ?)
`);

const updateMatchNames = db.prepare(`
  UPDATE matches
  SET
    home_team = CASE
      WHEN home_team = ? THEN ?
      ELSE home_team
    END,
    away_team = CASE
      WHEN away_team = ? THEN ?
      ELSE away_team
    END,
    updated_at = ?
  WHERE competition = ?
`);

const transaction = db.transaction(() => {
  for (const group of canonicalGroups) {
    const canonicalTeam = getTeam(
      group.canonical,
      group.competition
    );

    if (!canonicalTeam) {
      console.log(
        `SKIP: canonical team tidak ditemukan: ${group.canonical}`
      );
      continue;
    }

    console.log(
      `\nCanonical: ${group.canonical} (team_id ${canonicalTeam.id})`
    );

    for (const alias of group.aliases) {
      insertAlias.run(
        canonicalTeam.id,
        alias,
        group.competition,
        "football-data.org",
        now
      );

      if (alias !== group.canonical) {
        updateMatchNames.run(
          alias,
          group.canonical,
          alias,
          group.canonical,
          now,
          group.competition
        );

        console.log(`  ${alias} -> ${group.canonical}`);
      }
    }
  }
});

transaction();

console.log("\n=== HASIL CANONICAL TEAM ===");

const teams = db.prepare(`
  SELECT
    id,
    name,
    competition
  FROM teams
  ORDER BY competition, name
`).all();

console.table(teams);

console.log("\n=== TEAM ALIASES ===");

const aliases = db.prepare(`
  SELECT
    team_id,
    alias,
    competition,
    source
  FROM team_aliases
  ORDER BY competition, alias
`).all();

console.table(aliases);

db.close();
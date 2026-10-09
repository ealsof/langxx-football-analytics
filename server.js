
import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || __dirname);
const DB_PATH = path.join(DATA_DIR, 'football.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const now = () => new Date().toISOString();

const MODEL_VERSION = 'ensemble_60_40';
const FALLBACK_MODEL_VERSION = 'v0.1-fallback';
const HISTORY_THRESHOLD = 30;
const V02_WEIGHT = 0.60;
const V04_WEIGHT = 0.40;

const FALLBACK_HOME_PROB = 0.45;
const FALLBACK_DRAW_PROB = 0.27;
const FALLBACK_AWAY_PROB = 0.28;
const FALLBACK_HOME_GOALS = 1.55;
const FALLBACK_AWAY_GOALS = 1.05;

// ============================================================
// DATABASE SCHEMA
// All tables are created before any indexes reference them.
// Existing database files are retained.
// ============================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    competition TEXT NOT NULL,
    kickoff TEXT NOT NULL,
    status TEXT DEFAULT 'scheduled',
    home_score INTEGER,
    away_score INTEGER,
    source TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS match_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    provider_match_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, provider_match_id),
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );

  CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    model_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    home_prob REAL NOT NULL,
    draw_prob REAL NOT NULL,
    away_prob REAL NOT NULL,
    predicted_home_goals REAL,
    predicted_away_goals REAL,
    predicted_result TEXT NOT NULL,
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );

  CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL,
    evaluated_at TEXT NOT NULL,
    actual_result TEXT,
    exact_score_hit INTEGER DEFAULT 0,
    result_hit INTEGER DEFAULT 0,
    home_goal_error REAL,
    away_goal_error REAL,
    FOREIGN KEY(prediction_id) REFERENCES predictions(id)
  );

  CREATE TABLE IF NOT EXISTS model_versions (
    version TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    accuracy REAL,
    notes TEXT
  );
`);

// Ensure required columns exist if an older database schema is present.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const migrations = {
  matches: {
    status: "TEXT DEFAULT 'scheduled'",
    home_score: 'INTEGER',
    away_score: 'INTEGER',
    source: 'TEXT',
    updated_at: "TEXT NOT NULL DEFAULT ''"
  },
  match_sources: {
    created_at: "TEXT NOT NULL DEFAULT ''",
    updated_at: "TEXT NOT NULL DEFAULT ''"
  },
  predictions: {
    model_version: "TEXT NOT NULL DEFAULT 'v0.1'",
    created_at: "TEXT NOT NULL DEFAULT ''",
    home_prob: 'REAL NOT NULL DEFAULT 0.333333',
    draw_prob: 'REAL NOT NULL DEFAULT 0.333333',
    away_prob: 'REAL NOT NULL DEFAULT 0.333334',
    predicted_home_goals: 'REAL',
    predicted_away_goals: 'REAL',
    predicted_result: "TEXT NOT NULL DEFAULT 'H'"
  },
  evaluations: {
    evaluated_at: "TEXT NOT NULL DEFAULT ''",
    actual_result: 'TEXT',
    exact_score_hit: 'INTEGER DEFAULT 0',
    result_hit: 'INTEGER DEFAULT 0',
    home_goal_error: 'REAL',
    away_goal_error: 'REAL'
  }
};

for (const [table, columns] of Object.entries(migrations)) {
  for (const [column, definition] of Object.entries(columns)) {
    ensureColumn(table, column, definition);
  }
}

// IMPORTANT: indexes are created only after all relevant tables exist.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_matches_kickoff
    ON matches(kickoff);

  CREATE INDEX IF NOT EXISTS idx_matches_competition
    ON matches(competition);

  CREATE INDEX IF NOT EXISTS idx_predictions_match
    ON predictions(match_id);

  CREATE INDEX IF NOT EXISTS idx_predictions_version
    ON predictions(model_version);

  CREATE INDEX IF NOT EXISTS idx_match_sources_lookup
    ON match_sources(provider, provider_match_id);

  CREATE INDEX IF NOT EXISTS idx_match_sources_match
    ON match_sources(match_id);

  CREATE INDEX IF NOT EXISTS idx_evaluations_prediction
    ON evaluations(prediction_id);
`);

db.prepare(`
  INSERT OR IGNORE INTO model_versions(version, status, created_at, notes)
  VALUES (?, ?, ?, ?)
`).run(
  'v0.1',
  'legacy',
  now(),
  'Original baseline architecture'
);

db.prepare(`
  INSERT OR IGNORE INTO model_versions(version, status, created_at, notes)
  VALUES (?, ?, ?, ?)
`).run(
  MODEL_VERSION,
  'production',
  now(),
  'Ensemble V0.2 60% + V0.4 40%; history threshold 30; calibration OFF'
);

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// GENERAL HELPERS
// ============================================================

function result(home, away) {
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
}

function factorial(n) {
  let value = 1;
  for (let i = 2; i <= n; i++) value *= i;
  return value;
}

function poisson(lambda, k) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function clip(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeProbabilities(home, draw, away) {
  const total = home + draw + away;

  if (!Number.isFinite(total) || total <= 0) {
    return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  }

  return {
    home: home / total,
    draw: draw / total,
    away: away / total
  };
}

function poissonPrediction(homeGoals, awayGoals) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let h = 0; h <= 10; h++) {
    for (let a = 0; a <= 10; a++) {
      const probability = poisson(homeGoals, h) * poisson(awayGoals, a);

      if (h > a) homeWin += probability;
      else if (h === a) draw += probability;
      else awayWin += probability;
    }
  }

  const probabilities = normalizeProbabilities(homeWin, draw, awayWin);

  const predictedResult =
    probabilities.home >= probabilities.draw &&
    probabilities.home >= probabilities.away
      ? 'H'
      : probabilities.draw >= probabilities.away
        ? 'D'
        : 'A';

  return {
    homeProb: probabilities.home,
    drawProb: probabilities.draw,
    awayProb: probabilities.away,
    predictedHomeGoals: homeGoals,
    predictedAwayGoals: awayGoals,
    predictedResult
  };
}

// ============================================================
// V0.2 — SAME-COMPETITION HISTORICAL GOALS
// ============================================================

function predictV02(target, priorMatches) {
  const finished = priorMatches.filter(
    match => match.home_score !== null && match.away_score !== null
  );

  if (finished.length < HISTORY_THRESHOLD) return null;

  let leagueHomeGoals = 0;
  let leagueAwayGoals = 0;
  let homeGames = 0;
  let awayGames = 0;
  let homeGoalsFor = 0;
  let homeGoalsAgainst = 0;
  let awayGoalsFor = 0;
  let awayGoalsAgainst = 0;

  for (const match of finished) {
    const homeScore = Number(match.home_score);
    const awayScore = Number(match.away_score);

    leagueHomeGoals += homeScore;
    leagueAwayGoals += awayScore;

    if (match.home_team === target.home_team) {
      homeGames++;
      homeGoalsFor += homeScore;
      homeGoalsAgainst += awayScore;
    }

    if (match.away_team === target.home_team) {
      homeGames++;
      homeGoalsFor += awayScore;
      homeGoalsAgainst += homeScore;
    }

    if (match.home_team === target.away_team) {
      awayGames++;
      awayGoalsFor += homeScore;
      awayGoalsAgainst += awayScore;
    }

    if (match.away_team === target.away_team) {
      awayGames++;
      awayGoalsFor += awayScore;
      awayGoalsAgainst += homeScore;
    }
  }

  if (homeGames === 0 || awayGames === 0) return null;

  const leagueHomeAverage = leagueHomeGoals / finished.length;
  const leagueAwayAverage = leagueAwayGoals / finished.length;

  if (leagueHomeAverage <= 0 || leagueAwayAverage <= 0) return null;

  const homeAttack =
    homeGoalsFor / Math.max(leagueHomeAverage * homeGames, 0.1);

  const awayAttack =
    awayGoalsFor / Math.max(leagueAwayAverage * awayGames, 0.1);

  const homeDefense =
    homeGoalsAgainst / Math.max(leagueAwayAverage * homeGames, 0.1);

  const awayDefense =
    awayGoalsAgainst / Math.max(leagueHomeAverage * awayGames, 0.1);

  const homeGoals = clip(
    leagueHomeAverage * homeAttack * awayDefense * 1.05,
    0.2,
    4.5
  );

  const awayGoals = clip(
    leagueAwayAverage * awayAttack * homeDefense,
    0.2,
    4.5
  );

  return poissonPrediction(homeGoals, awayGoals);
}

// ============================================================
// V0.4 — ELO
// ============================================================

function eloExpected(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function eloMarginMultiplier(goalMargin) {
  if (goalMargin <= 1) return 1;
  if (goalMargin === 2) return 1.25;
  return 1.5;
}

function predictV04(target, priorMatches) {
  const finished = priorMatches
    .filter(match => match.home_score !== null && match.away_score !== null)
    .sort(
      (a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()
    );

  if (finished.length < HISTORY_THRESHOLD) return null;

  const ratings = new Map();

  function getRating(team) {
    if (!ratings.has(team)) ratings.set(team, 1500);
    return ratings.get(team);
  }

  function setRating(team, rating) {
    ratings.set(team, rating);
  }

  for (const match of finished) {
    const home = match.home_team;
    const away = match.away_team;
    const homeScore = Number(match.home_score);
    const awayScore = Number(match.away_score);

    const homeRating = getRating(home);
    const awayRating = getRating(away);
    const expectedHome = eloExpected(homeRating + 60, awayRating);
    const actualHome = homeScore > awayScore ? 1 : homeScore === awayScore ? 0.5 : 0;
    const multiplier = eloMarginMultiplier(Math.abs(homeScore - awayScore));
    const k = 25 * multiplier;

    setRating(home, homeRating + k * (actualHome - expectedHome));
    setRating(away, awayRating + k * ((1 - actualHome) - (1 - expectedHome)));
  }

  const difference =
    getRating(target.home_team) + 60 - getRating(target.away_team);

  const homeFactor = clip(1 + difference / 1000, 0.65, 1.35);
  const awayFactor = clip(1 - difference / 1200, 0.65, 1.35);

  let leagueHomeGoals = 0;
  let leagueAwayGoals = 0;

  for (const match of finished) {
    leagueHomeGoals += Number(match.home_score);
    leagueAwayGoals += Number(match.away_score);
  }

  const homeAverage = leagueHomeGoals / finished.length;
  const awayAverage = leagueAwayGoals / finished.length;

  return poissonPrediction(
    clip(homeAverage * homeFactor, 0.2, 4.5),
    clip(awayAverage * awayFactor, 0.2, 4.5)
  );
}

// ============================================================
// ENSEMBLE 60:40 AND FALLBACK
// ============================================================

function predictEnsemble(target, priorMatches) {
  if (priorMatches.length < HISTORY_THRESHOLD) return null;

  const v02 = predictV02(target, priorMatches);
  const v04 = predictV04(target, priorMatches);

  if (!v02 || !v04) return null;

  const probabilities = normalizeProbabilities(
    V02_WEIGHT * v02.homeProb + V04_WEIGHT * v04.homeProb,
    V02_WEIGHT * v02.drawProb + V04_WEIGHT * v04.drawProb,
    V02_WEIGHT * v02.awayProb + V04_WEIGHT * v04.awayProb
  );

  const predictedResult =
    probabilities.home >= probabilities.draw &&
    probabilities.home >= probabilities.away
      ? 'H'
      : probabilities.draw >= probabilities.away
        ? 'D'
        : 'A';

  return {
    homeProb: probabilities.home,
    drawProb: probabilities.draw,
    awayProb: probabilities.away,
    predictedHomeGoals:
      V02_WEIGHT * v02.predictedHomeGoals +
      V04_WEIGHT * v04.predictedHomeGoals,
    predictedAwayGoals:
      V02_WEIGHT * v02.predictedAwayGoals +
      V04_WEIGHT * v04.predictedAwayGoals,
    predictedResult,
    modelVersion: MODEL_VERSION,
    components: { v02: V02_WEIGHT, v04: V04_WEIGHT },
    historyMatches: priorMatches.length
  };
}

function fallbackPrediction() {
  return {
    homeProb: FALLBACK_HOME_PROB,
    drawProb: FALLBACK_DRAW_PROB,
    awayProb: FALLBACK_AWAY_PROB,
    predictedHomeGoals: FALLBACK_HOME_GOALS,
    predictedAwayGoals: FALLBACK_AWAY_GOALS,
    predictedResult: 'H',
    modelVersion: FALLBACK_MODEL_VERSION,
    components: { v02: 0, v04: 0 },
    historyMatches: 0
  };
}

function getPriorMatches(target) {
  return db.prepare(`
    SELECT id, home_team, away_team, competition, kickoff, status,
           home_score, away_score
    FROM matches
    WHERE LOWER(status) = 'finished'
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
      AND competition = ?
      AND kickoff < ?
    ORDER BY kickoff ASC
  `).all(target.competition, target.kickoff);
}

// ============================================================
// CREATE PREDICTIONS
// ============================================================

function createPredictions() {
  const matches = db.prepare(`
    SELECT *
    FROM matches
    WHERE kickoff > ?
      AND LOWER(status) IN ('scheduled', 'timed')
    ORDER BY kickoff ASC
  `).all(now());

  const insert = db.prepare(`
    INSERT INTO predictions(
      match_id, model_version, created_at,
      home_prob, draw_prob, away_prob,
      predicted_home_goals, predicted_away_goals, predicted_result
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let ensembleCount = 0;
  let fallbackCount = 0;
  let skippedCount = 0;

  db.transaction(() => {
    for (const match of matches) {
      const existing = db.prepare(`
        SELECT 1 FROM predictions
        WHERE match_id = ? AND model_version = ?
        LIMIT 1
      `).get(match.id, MODEL_VERSION);

      if (existing) {
        skippedCount++;
        continue;
      }

      const priorMatches = getPriorMatches(match);
      let prediction = predictEnsemble(match, priorMatches);

      if (prediction) {
        ensembleCount++;
      } else {
        prediction = fallbackPrediction();
        fallbackCount++;
      }

      insert.run(
        match.id,
        prediction.modelVersion,
        now(),
        prediction.homeProb,
        prediction.drawProb,
        prediction.awayProb,
        prediction.predictedHomeGoals,
        prediction.predictedAwayGoals,
        prediction.predictedResult
      );
    }
  })();

  return {
    model: MODEL_VERSION,
    threshold: HISTORY_THRESHOLD,
    weights: { v02: V02_WEIGHT, v04: V04_WEIGHT },
    calibration: false,
    matchesChecked: matches.length,
    ensembleCreated: ensembleCount,
    fallbackCreated: fallbackCount,
    alreadyExisting: skippedCount
  };
}

// ============================================================
// EVALUATION
// ============================================================

function evaluateFinished() {
  const rows = db.prepare(`
    SELECT p.*, m.home_score, m.away_score
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    WHERE LOWER(m.status) = 'finished'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND p.model_version IN ('ensemble_60_40', 'v0.1-fallback')
      AND NOT EXISTS (
        SELECT 1 FROM evaluations e WHERE e.prediction_id = p.id
      )
  `).all();

  const insert = db.prepare(`
    INSERT INTO evaluations(
      prediction_id, evaluated_at, actual_result, exact_score_hit,
      result_hit, home_goal_error, away_goal_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const row of rows) {
      const actualResult = result(row.home_score, row.away_score);
      const exactScoreHit =
        Math.round(row.predicted_home_goals) === row.home_score &&
        Math.round(row.predicted_away_goals) === row.away_score
          ? 1
          : 0;

      const resultHit = actualResult === row.predicted_result ? 1 : 0;
      const homeGoalError = Math.abs(row.predicted_home_goals - row.home_score);
      const awayGoalError = Math.abs(row.predicted_away_goals - row.away_score);

      insert.run(
        row.id,
        now(),
        actualResult,
        exactScoreHit,
        resultHit,
        homeGoalError,
        awayGoalError
      );
    }
  })();

  return { evaluated: rows.length };
}

// ============================================================
// TEAM-NAME MATCHING
// Prevent duplicate imports when older matches lack source mappings.
// ============================================================

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findExistingMatch(homeTeam, awayTeam, competition, kickoff) {
  const rows = db.prepare(`
    SELECT id, home_team, away_team, competition, kickoff
    FROM matches
    WHERE competition = ?
      AND ABS(
        strftime('%s', kickoff) - strftime('%s', ?)
      ) <= 120
    LIMIT 100
  `).all(competition, kickoff);

  const homeKey = normalizeName(homeTeam);
  const awayKey = normalizeName(awayTeam);

  return rows.find(row =>
    normalizeName(row.home_team) === homeKey &&
    normalizeName(row.away_team) === awayKey
  ) ?? null;
}

// ============================================================
// MOCK SYNC
// ============================================================

function mockSync() {
  const samples = [
    ['Arsenal', 'Chelsea', 'Premier League', 1],
    ['Liverpool', 'Manchester United', 'Premier League', 2],
    ['Barcelona', 'Real Madrid', 'La Liga', 3]
  ];

  const insertMatch = db.prepare(`
    INSERT INTO matches(
      home_team, away_team, competition, kickoff,
      status, source, updated_at
    ) VALUES (?, ?, ?, ?, 'scheduled', 'mock', ?)
  `);

  db.transaction(() => {
    for (const [home, away, competition, daysAhead] of samples) {
      const kickoff = new Date(
        Date.now() + daysAhead * 86400000
      ).toISOString();

      const existing = findExistingMatch(
        home, away, competition, kickoff
      );

      if (!existing) {
        insertMatch.run(home, away, competition, kickoff, now());
      }
    }
  })();

  return {
    mode: 'mock',
    predictions: createPredictions(),
    evaluations: evaluateFinished()
  };
}

// ============================================================
// REAL SYNC — FOOTBALL-DATA.ORG
// ============================================================

async function sync() {
  if (process.env.MOCK_MODE === 'true') {
    return mockSync();
  }

  const token = process.env.FOOTBALL_DATA_API_TOKEN;
  if (!token) {
    throw new Error(
      'FOOTBALL_DATA_API_TOKEN tidak ditemukan di environment variables.'
    );
  }

  const competitions = [
    { code: 'PL', name: 'Premier League' },
    { code: 'PD', name: 'La Liga' }
  ];

  const findSource = db.prepare(`
    SELECT match_id FROM match_sources
    WHERE provider = ? AND provider_match_id = ?
  `);

  const insertMatch = db.prepare(`
    INSERT INTO matches(
      home_team, away_team, competition, kickoff, status,
      home_score, away_score, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO match_sources(
      match_id, provider, provider_match_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `);

  const updateMatch = db.prepare(`
    UPDATE matches
    SET status = ?, home_score = ?, away_score = ?, updated_at = ?
    WHERE id = ?
  `);

  let totalReceived = 0;
  let totalImported = 0;
  let totalUpdated = 0;
  let totalLinked = 0;

  for (const competition of competitions) {
    const url =
      `https://api.football-data.org/v4/competitions/${competition.code}/matches`;

    const response = await fetch(url, {
      headers: { 'X-Auth-Token': token }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `football-data.org ${competition.code} HTTP ${response.status}: ${body.slice(0, 500)}`
      );
    }

    const json = await response.json();
    const providerMatches = Array.isArray(json.matches) ? json.matches : [];
    totalReceived += providerMatches.length;

    for (const match of providerMatches) {
      const providerMatchId = String(match.id);
      const homeTeam = match.homeTeam?.name || 'Unknown Home Team';
      const awayTeam = match.awayTeam?.name || 'Unknown Away Team';
      const kickoff = match.utcDate;
      const status = String(match.status || 'SCHEDULED').toLowerCase();
      const homeScore = match.score?.fullTime?.home ?? null;
      const awayScore = match.score?.fullTime?.away ?? null;

      const mapped = findSource.get(
        'football-data.org',
        providerMatchId
      );

      if (mapped) {
        updateMatch.run(
          status, homeScore, awayScore, now(), mapped.match_id
        );

        db.prepare(`
          UPDATE match_sources SET updated_at = ?
          WHERE provider = ? AND provider_match_id = ?
        `).run(now(), 'football-data.org', providerMatchId);

        totalUpdated++;
        continue;
      }

      // Match against existing data before inserting a new row.
      const existingMatch = findExistingMatch(
        homeTeam,
        awayTeam,
        competition.name,
        kickoff
      );

      if (existingMatch) {
        db.transaction(() => {
          updateMatch.run(
            status, homeScore, awayScore, now(), existingMatch.id
          );

          insertSource.run(
            existingMatch.id,
            'football-data.org',
            providerMatchId,
            now(),
            now()
          );
        })();

        totalLinked++;
        continue;
      }

      db.transaction(() => {
        const inserted = insertMatch.run(
          homeTeam,
          awayTeam,
          competition.name,
          kickoff,
          status,
          homeScore,
          awayScore,
          'football-data.org',
          now()
        );

        insertSource.run(
          Number(inserted.lastInsertRowid),
          'football-data.org',
          providerMatchId,
          now(),
          now()
        );
      })();

      totalImported++;
    }
  }

  return {
    mode: 'football-data.org',
    competitions: ['PL', 'PD'],
    fixtures_received: totalReceived,
    fixtures_imported: totalImported,
    fixtures_updated: totalUpdated,
    existing_matches_linked: totalLinked,
    predictions: createPredictions(),
    evaluations: evaluateFinished()
  };
}

// ============================================================
// API ROUTES
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    time: now(),
    automation: 'enabled',
    mock: process.env.MOCK_MODE === 'true',
    productionModel: MODEL_VERSION,
    fallbackModel: FALLBACK_MODEL_VERSION,
    threshold: HISTORY_THRESHOLD,
    weights: { v02: V02_WEIGHT, v04: V04_WEIGHT },
    calibration: false,
    database: DB_PATH
  });
});

app.get('/api/matches', (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT * FROM matches
      ORDER BY kickoff ASC
      LIMIT 100
    `).all());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/predictions', (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT p.*, m.home_team, m.away_team, m.competition,
             m.kickoff, m.status, m.home_score, m.away_score
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      WHERE p.id IN (
        SELECT MAX(p2.id)
        FROM predictions p2
        GROUP BY p2.match_id
      )
        AND m.kickoff >= datetime('now')
        AND LOWER(m.status) IN ('scheduled', 'timed')
      ORDER BY m.kickoff ASC
      LIMIT 100
    `).all());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/evaluations', (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT e.*, p.model_version, m.home_team, m.away_team,
             m.home_score, m.away_score
      FROM evaluations e
      JOIN predictions p ON p.id = e.prediction_id
      JOIN matches m ON m.id = p.match_id
      ORDER BY e.evaluated_at DESC
      LIMIT 100
    `).all());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/metrics', (req, res) => {
  try {
    const metrics = db.prepare(`
      SELECT
        COUNT(*) AS n,
        COALESCE(AVG(e.result_hit), 0) AS accuracy,
        COALESCE(AVG(e.exact_score_hit), 0) AS exact_score,
        COALESCE(
          AVG((e.home_goal_error + e.away_goal_error) / 2.0),
          0
        ) AS goal_mae
      FROM evaluations e
      JOIN predictions p ON p.id = e.prediction_id
      WHERE p.model_version IN ('ensemble_60_40', 'v0.1-fallback')
    `).get();

    res.json({
      model: MODEL_VERSION,
      threshold: HISTORY_THRESHOLD,
      weights: { v02: V02_WEIGHT, v04: V04_WEIGHT },
      calibration: false,
      ...metrics
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/model', (req, res) => {
  res.json({
    model: MODEL_VERSION,
    components: { V02: V02_WEIGHT, V04: V04_WEIGHT },
    threshold: HISTORY_THRESHOLD,
    calibration: { enabled: false, method: null },
    fallback: FALLBACK_MODEL_VERSION,
    productionChange: true,
    database: 'SQLite'
  });
});

app.post('/api/admin/sync', async (req, res) => {
  try {
    res.json(await sync());
  } catch (error) {
    console.error('[manual-sync]', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// AUTOMATED SYNC
// ============================================================

cron.schedule(
  process.env.SYNC_CRON || '*/15 * * * *',
  async () => {
    try {
      console.log('[automation] sync started', now());
      const data = await sync();
      console.log('[automation] sync completed', data);
    } catch (error) {
      console.error('[automation]', error.message);
    }
  }
);

// ============================================================
// START SERVER, THEN RUN INITIAL SYNC
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Football Analytics Lab running on port ${PORT}`);
  console.log(`[database] ${DB_PATH}`);
  console.log(`[model] ${MODEL_VERSION}`);
  console.log(`[model] V0.2=${V02_WEIGHT}, V0.4=${V04_WEIGHT}`);
  console.log(`[model] threshold=${HISTORY_THRESHOLD}`);
  console.log('[model] calibration=OFF');

  sync()
    .then(data => console.log('[startup] sync completed', data))
    .catch(error => console.error('[startup]', error.message));
});
import 'dotenv/config';

import express from 'express';
import crypto from 'node:crypto';
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

const FINAL_STATUSES = new Set(['FINISHED', 'AWARDED']);

// ============================================================
// DATABASE SCHEMA
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
    prediction_type TEXT NOT NULL DEFAULT 'live',
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

// ============================================================
// DATABASE MIGRATIONS
// ============================================================

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some((item) => item.name === column)) {
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
    prediction_type: "TEXT NOT NULL DEFAULT 'live'",
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

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_matches_kickoff
    ON matches(kickoff);

  CREATE INDEX IF NOT EXISTS idx_matches_competition
    ON matches(competition);

  CREATE INDEX IF NOT EXISTS idx_predictions_match
    ON predictions(match_id);

  CREATE INDEX IF NOT EXISTS idx_predictions_version
    ON predictions(model_version);

  CREATE INDEX IF NOT EXISTS idx_predictions_type
    ON predictions(prediction_type);

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

  for (let i = 2; i <= n; i++) {
    value *= i;
  }

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
    return {
      home: 1 / 3,
      draw: 1 / 3,
      away: 1 / 3
    };
  }

  return {
    home: home / total,
    draw: draw / total,
    away: away / total
  };
}

function isNumericScore(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(Number(value))
  );
}

function normalizeProviderMatch(match) {
  const rawStatus = String(match.status || 'SCHEDULED').toUpperCase();

  // Hanya hasil final yang disimpan sebagai skor pertandingan.
  // Skor 0 dari API pada laga yang belum dimainkan bukan hasil 0-0.
  const isFinal = FINAL_STATUSES.has(rawStatus);

  const rawHomeScore = match.score?.fullTime?.home;
  const rawAwayScore = match.score?.fullTime?.away;

  const hasFinalScore =
    isFinal &&
    isNumericScore(rawHomeScore) &&
    isNumericScore(rawAwayScore);

  return {
    providerMatchId: String(match.id),
    homeTeam: match.homeTeam?.name || 'Unknown Home Team',
    awayTeam: match.awayTeam?.name || 'Unknown Away Team',
    kickoff: match.utcDate,
    status: isFinal ? 'finished' : rawStatus.toLowerCase(),
    homeScore: hasFinalScore ? Number(rawHomeScore) : null,
    awayScore: hasFinalScore ? Number(rawAwayScore) : null
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
// V0.2 â€” SAME-COMPETITION HISTORICAL GOALS
// ============================================================

function predictV02(target, priorMatches) {
  const finished = priorMatches.filter(
    (match) =>
      match.home_score !== null &&
      match.away_score !== null
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

  if (leagueHomeAverage <= 0 || leagueAwayAverage <= 0) {
    return null;
  }

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
// V0.4 â€” ELO
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
    .filter(
      (match) =>
        match.home_score !== null &&
        match.away_score !== null
    )
    .sort(
      (a, b) =>
        new Date(a.kickoff).getTime() -
        new Date(b.kickoff).getTime()
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

    const actualHome =
      homeScore > awayScore
        ? 1
        : homeScore === awayScore
          ? 0.5
          : 0;

    const multiplier = eloMarginMultiplier(
      Math.abs(homeScore - awayScore)
    );

    const k = 25 * multiplier;

    setRating(
      home,
      homeRating + k * (actualHome - expectedHome)
    );

    setRating(
      away,
      awayRating +
        k * ((1 - actualHome) - (1 - expectedHome))
    );
  }

  const difference =
    getRating(target.home_team) +
    60 -
    getRating(target.away_team);

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
    components: {
      v02: V02_WEIGHT,
      v04: V04_WEIGHT
    },
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
    components: {
      v02: 0,
      v04: 0
    },
    historyMatches: 0
  };
}

function getPriorMatches(target) {
  return db.prepare(`
    SELECT
      id,
      home_team,
      away_team,
      competition,
      kickoff,
      status,
      home_score,
      away_score
    FROM matches
    WHERE LOWER(status) = 'finished'
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
      AND competition = ?
      AND julianday(kickoff) < julianday(?)
    ORDER BY kickoff ASC
  `).all(target.competition, target.kickoff);
}

// ============================================================
// PREDICTION INSERT / UPDATE HELPERS
// ============================================================

function savePrediction(match, prediction, predictionType) {
  const existing = db.prepare(`
    SELECT id
    FROM predictions
    WHERE match_id = ?
      AND model_version = ?
      AND prediction_type = ?
    LIMIT 1
  `).get(match.id, prediction.modelVersion, predictionType);

  if (existing) return false;

  db.prepare(`
    INSERT INTO predictions (
      match_id,
      model_version,
      prediction_type,
      created_at,
      home_prob,
      draw_prob,
      away_prob,
      predicted_home_goals,
      predicted_away_goals,
      predicted_result
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    match.id,
    prediction.modelVersion,
    predictionType,
    now(),
    prediction.homeProb,
    prediction.drawProb,
    prediction.awayProb,
    prediction.predictedHomeGoals,
    prediction.predictedAwayGoals,
    prediction.predictedResult
  );

  return true;
}

// ============================================================
// LIVE PREDICTIONS
// ============================================================

function createPredictions() {
  const matches = db.prepare(`
    SELECT *
    FROM matches
    WHERE julianday(kickoff) > julianday(?)
      AND LOWER(status) IN ('scheduled', 'timed')
    ORDER BY kickoff ASC
  `).all(now());

  let ensembleCount = 0;
  let fallbackCount = 0;
  let skippedCount = 0;
  let upgradedFallbackCount = 0;

  const findLiveEnsemble = db.prepare(`
    SELECT id
    FROM predictions
    WHERE match_id = ?
      AND model_version = ?
      AND prediction_type = 'live'
    LIMIT 1
  `);

  const findLiveFallback = db.prepare(`
    SELECT id
    FROM predictions
    WHERE match_id = ?
      AND model_version = ?
      AND prediction_type = 'live'
    LIMIT 1
  `);

  const updateFallback = db.prepare(`
    UPDATE predictions
    SET
      model_version = ?,
      created_at = ?,
      home_prob = ?,
      draw_prob = ?,
      away_prob = ?,
      predicted_home_goals = ?,
      predicted_away_goals = ?,
      predicted_result = ?
    WHERE id = ?
  `);

  db.transaction(() => {
    for (const match of matches) {
      const existingEnsemble = findLiveEnsemble.get(
        match.id,
        MODEL_VERSION
      );

      if (existingEnsemble) {
        skippedCount++;
        continue;
      }

      const priorMatches = getPriorMatches(match);
      const ensemble = predictEnsemble(match, priorMatches);

      const existingFallback = findLiveFallback.get(
        match.id,
        FALLBACK_MODEL_VERSION
      );

      // Jika prediksi sebelumnya fallback dan kini sudah cukup histori,
      // perbarui prediksi tersebut menjadi ensemble agar tidak duplikat.
      if (ensemble && existingFallback) {
        updateFallback.run(
          MODEL_VERSION,
          now(),
          ensemble.homeProb,
          ensemble.drawProb,
          ensemble.awayProb,
          ensemble.predictedHomeGoals,
          ensemble.predictedAwayGoals,
          ensemble.predictedResult,
          existingFallback.id
        );

        upgradedFallbackCount++;
        ensembleCount++;
        continue;
      }

      // Jangan menambahkan fallback berulang pada setiap siklus cron.
      if (!ensemble && existingFallback) {
        skippedCount++;
        continue;
      }

      const prediction = ensemble || fallbackPrediction();

      if (savePrediction(match, prediction, 'live')) {
        if (ensemble) ensembleCount++;
        else fallbackCount++;
      }
    }
  })();

  return {
    model: MODEL_VERSION,
    threshold: HISTORY_THRESHOLD,
    weights: {
      v02: V02_WEIGHT,
      v04: V04_WEIGHT
    },
    calibration: false,
    matchesChecked: matches.length,
    ensembleCreated: ensembleCount,
    fallbackCreated: fallbackCount,
    fallbackUpgraded: upgradedFallbackCount,
    alreadyExisting: skippedCount
  };
}

// ============================================================
// HISTORICAL BACKTEST PREDICTIONS
//
// Generate retrospective predictions using only matches that
// started earlier than each target match. These are labelled
// "backtest" and are reported separately from live predictions.
// ============================================================

function createBacktestPredictions() {
  const finishedMatches = db.prepare(`
    SELECT *
    FROM matches
    WHERE LOWER(status) = 'finished'
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
    ORDER BY kickoff ASC
  `).all();

  const existingBacktest = db.prepare(`
    SELECT 1
    FROM predictions
    WHERE match_id = ?
      AND prediction_type = 'backtest'
    LIMIT 1
  `);

  const existingLiveEnsemble = db.prepare(`
    SELECT 1
    FROM predictions
    WHERE match_id = ?
      AND model_version = ?
      AND prediction_type = 'live'
    LIMIT 1
  `);

  let ensembleCount = 0;
  let fallbackCount = 0;
  let skippedCount = 0;

  db.transaction(() => {
    for (const match of finishedMatches) {
      // Jangan buat backtest kedua untuk pertandingan yang sama.
      if (existingBacktest.get(match.id)) {
        skippedCount++;
        continue;
      }

      // Jika prediksi langsung memang sudah dibuat sebelum pertandingan,
      // gunakan hasil prediksi langsung itu untuk evaluasi, bukan duplikat backtest.
      if (existingLiveEnsemble.get(match.id, MODEL_VERSION)) {
        skippedCount++;
        continue;
      }

      const priorMatches = getPriorMatches(match);
      const ensemble = predictEnsemble(match, priorMatches);
      const prediction = ensemble || fallbackPrediction();

      if (savePrediction(match, prediction, 'backtest')) {
        if (ensemble) ensembleCount++;
        else fallbackCount++;
      }
    }
  })();

  return {
    matchesChecked: finishedMatches.length,
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
    SELECT
      p.*,
      m.home_score,
      m.away_score
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    WHERE LOWER(m.status) = 'finished'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND p.model_version IN (?, ?)
      AND p.prediction_type IN ('live', 'backtest')
      AND NOT EXISTS (
        SELECT 1
        FROM evaluations e
        WHERE e.prediction_id = p.id
      )
  `).all(MODEL_VERSION, FALLBACK_MODEL_VERSION);

  const insert = db.prepare(`
    INSERT INTO evaluations (
      prediction_id,
      evaluated_at,
      actual_result,
      exact_score_hit,
      result_hit,
      home_goal_error,
      away_goal_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (const row of rows) {
      const actualResult = result(
        Number(row.home_score),
        Number(row.away_score)
      );

      const exactScoreHit =
        Math.round(Number(row.predicted_home_goals)) ===
          Number(row.home_score) &&
        Math.round(Number(row.predicted_away_goals)) ===
          Number(row.away_score)
          ? 1
          : 0;

      const resultHit =
        actualResult === row.predicted_result ? 1 : 0;

      const homeGoalError = Math.abs(
        Number(row.predicted_home_goals) - Number(row.home_score)
      );

      const awayGoalError = Math.abs(
        Number(row.predicted_away_goals) - Number(row.away_score)
      );

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

  return {
    evaluated: rows.length
  };
}

// ============================================================
// TEAM-NAME MATCHING
// ============================================================

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findExistingMatch(
  homeTeam,
  awayTeam,
  competition,
  kickoff
) {
  const rows = db.prepare(`
    SELECT
      id,
      home_team,
      away_team,
      competition,
      kickoff
    FROM matches
    WHERE competition = ?
      AND ABS(
        strftime('%s', kickoff) - strftime('%s', ?)
      ) <= 120
    LIMIT 100
  `).all(competition, kickoff);

  const homeKey = normalizeName(homeTeam);
  const awayKey = normalizeName(awayTeam);

  return rows.find(
    (row) =>
      normalizeName(row.home_team) === homeKey &&
      normalizeName(row.away_team) === awayKey
  ) ?? null;
}

// ============================================================
// RUN ALL POST-SYNC TASKS
// ============================================================

function runPredictionPipeline() {
  const backtest = createBacktestPredictions();
  const predictions = createPredictions();
  const evaluations = evaluateFinished();

  return {
    backtest,
    predictions,
    evaluations
  };
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
    INSERT INTO matches (
      home_team,
      away_team,
      competition,
      kickoff,
      status,
      source,
      updated_at
    )
    VALUES (?, ?, ?, ?, 'scheduled', 'mock', ?)
  `);

  db.transaction(() => {
    for (const [home, away, competition, daysAhead] of samples) {
      const existing = db.prepare(`
        SELECT id
        FROM matches
        WHERE home_team = ?
          AND away_team = ?
          AND competition = ?
          AND source = 'mock'
        LIMIT 1
      `).get(home, away, competition);

      if (existing) continue;

      const kickoff = new Date(
        Date.now() + daysAhead * 86400000
      ).toISOString();

      insertMatch.run(
        home,
        away,
        competition,
        kickoff,
        now()
      );
    }
  })();

  return {
    mode: 'mock',
    ...runPredictionPipeline()
  };
}

// ============================================================
// REAL SYNC â€” FOOTBALL-DATA.ORG
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
    {
      code: 'PL',
      name: 'Premier League'
    },
    {
      code: 'PD',
      name: 'La Liga'
    }
  ];

  const findSource = db.prepare(`
    SELECT match_id
    FROM match_sources
    WHERE provider = ?
      AND provider_match_id = ?
  `);

  const insertMatch = db.prepare(`
    INSERT INTO matches (
      home_team,
      away_team,
      competition,
      kickoff,
      status,
      home_score,
      away_score,
      source,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO match_sources (
      match_id,
      provider,
      provider_match_id,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?)
  `);

  const updateMappedMatch = db.prepare(`
    UPDATE matches
    SET
      home_team = ?,
      away_team = ?,
      competition = ?,
      kickoff = ?,
      status = ?,
      home_score = ?,
      away_score = ?,
      source = ?,
      updated_at = ?
    WHERE id = ?
  `);

  const updateExistingMatch = db.prepare(`
    UPDATE matches
    SET
      status = ?,
      home_score = ?,
      away_score = ?,
      source = ?,
      updated_at = ?
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
      headers: {
        'X-Auth-Token': token
      }
    });

    if (!response.ok) {
      const body = await response.text();

      throw new Error(
        `football-data.org ${competition.code} HTTP ${response.status}: ${body.slice(0, 500)}`
      );
    }

    const json = await response.json();
    const providerMatches = Array.isArray(json.matches)
      ? json.matches
      : [];

    totalReceived += providerMatches.length;

    for (const providerMatch of providerMatches) {
      const match = normalizeProviderMatch(providerMatch);

      if (!match.kickoff) continue;

      const mapped = findSource.get(
        'football-data.org',
        match.providerMatchId
      );

      if (mapped) {
        updateMappedMatch.run(
          match.homeTeam,
          match.awayTeam,
          competition.name,
          match.kickoff,
          match.status,
          match.homeScore,
          match.awayScore,
          'football-data.org',
          now(),
          mapped.match_id
        );

        db.prepare(`
          UPDATE match_sources
          SET updated_at = ?
          WHERE provider = ?
            AND provider_match_id = ?
        `).run(
          now(),
          'football-data.org',
          match.providerMatchId
        );

        totalUpdated++;
        continue;
      }

      const existingMatch = findExistingMatch(
        match.homeTeam,
        match.awayTeam,
        competition.name,
        match.kickoff
      );

      if (existingMatch) {
        db.transaction(() => {
          updateExistingMatch.run(
            match.status,
            match.homeScore,
            match.awayScore,
            'football-data.org',
            now(),
            existingMatch.id
          );

          insertSource.run(
            existingMatch.id,
            'football-data.org',
            match.providerMatchId,
            now(),
            now()
          );
        })();

        totalLinked++;
        continue;
      }

      db.transaction(() => {
        const inserted = insertMatch.run(
          match.homeTeam,
          match.awayTeam,
          competition.name,
          match.kickoff,
          match.status,
          match.homeScore,
          match.awayScore,
          'football-data.org',
          now()
        );

        insertSource.run(
          Number(inserted.lastInsertRowid),
          'football-data.org',
          match.providerMatchId,
          now(),
          now()
        );
      })();

      totalImported++;
    }
  }

  const pipeline = runPredictionPipeline();

  return {
    mode: 'football-data.org',
    competitions: ['PL', 'PD'],
    fixtures_received: totalReceived,
    fixtures_imported: totalImported,
    fixtures_updated: totalUpdated,
    existing_matches_linked: totalLinked,
    ...pipeline
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
    weights: {
      v02: V02_WEIGHT,
      v04: V04_WEIGHT
    },
    calibration: false,
    database: DB_PATH
  });
});

app.get('/api/matches', (req, res) => {
  try {
    const scope = String(req.query.scope || 'all').toLowerCase();

    let query = `
      SELECT
        m.*,
        p.model_version AS prediction_model_version,
        p.prediction_type AS prediction_type,
        p.predicted_result,
        p.predicted_home_goals,
        p.predicted_away_goals,
        p.home_prob,
        p.draw_prob,
        p.away_prob
      FROM matches m
      LEFT JOIN predictions p ON p.id = (
        SELECT p2.id
        FROM predictions p2
        WHERE p2.match_id = m.id
        ORDER BY p2.created_at ASC, p2.id ASC
        LIMIT 1
      )
    `;

    if (scope === 'upcoming') {
      query += `
        WHERE julianday(m.kickoff) >= julianday('now')
          AND LOWER(m.status) IN ('scheduled', 'timed')
      `;
    } else if (scope === 'finished') {
      query += `
        WHERE LOWER(m.status) = 'finished'
          AND m.home_score IS NOT NULL
          AND m.away_score IS NOT NULL
      `;
    }

    query += `
      ORDER BY ${scope === 'finished' ? 'm.kickoff DESC' : 'm.kickoff ASC'}
      LIMIT 100
    `;

    res.json(db.prepare(query).all());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/predictions', (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT
        p.*,
        m.home_team,
        m.away_team,
        m.competition,
        m.kickoff,
        m.status,
        m.home_score,
        m.away_score
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      WHERE p.prediction_type = 'live'
        AND p.id IN (
          SELECT MAX(p2.id)
          FROM predictions p2
          WHERE p2.prediction_type = 'live'
          GROUP BY p2.match_id
        )
        AND julianday(m.kickoff) >= julianday('now')
        AND LOWER(m.status) IN ('scheduled', 'timed')
      ORDER BY m.kickoff ASC
      LIMIT 100
    `).all());
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/evaluations', (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT
        e.*,
        p.model_version,
        p.prediction_type,
        p.predicted_result,
        p.predicted_home_goals,
        p.predicted_away_goals,
        p.home_prob,
        p.draw_prob,
        p.away_prob,
        m.home_team,
        m.away_team,
        m.competition,
        m.kickoff,
        m.home_score,
        m.away_score
      FROM evaluations e
      JOIN predictions p ON p.id = e.prediction_id
      JOIN matches m ON m.id = p.match_id
      ORDER BY e.evaluated_at DESC
      LIMIT 200
    `).all());
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/metrics', (req, res) => {
  try {
    const groupedRows = db.prepare(`
      SELECT
        p.prediction_type,
        p.model_version,
        COUNT(*) AS n,
        COALESCE(AVG(e.result_hit), 0) AS accuracy,
        COALESCE(AVG(e.exact_score_hit), 0) AS exact_score,
        COALESCE(
          AVG((e.home_goal_error + e.away_goal_error) / 2.0),
          0
        ) AS goal_mae
      FROM evaluations e
      JOIN predictions p ON p.id = e.prediction_id
      WHERE p.model_version IN (?, ?)
      GROUP BY p.prediction_type, p.model_version
      ORDER BY p.prediction_type, p.model_version
    `).all(MODEL_VERSION, FALLBACK_MODEL_VERSION);

    const byType = { live: [], backtest: [] };

    for (const row of groupedRows) {
      const type = row.prediction_type === 'backtest'
        ? 'backtest'
        : 'live';

      byType[type].push({
        model_version: row.model_version,
        n: row.n,
        accuracy: row.accuracy,
        exact_score: row.exact_score,
        goal_mae: row.goal_mae
      });
    }

    const overall = groupedRows.find(
      row =>
        row.prediction_type === 'backtest' &&
        row.model_version === MODEL_VERSION
    );

    const metrics = overall
      ? {
          n: overall.n,
          accuracy: overall.accuracy,
          exact_score: overall.exact_score,
          goal_mae: overall.goal_mae
        }
      : { n: 0, accuracy: 0, exact_score: 0, goal_mae: 0 };

    res.json({
      model: MODEL_VERSION,
      threshold: HISTORY_THRESHOLD,
      weights: { v02: V02_WEIGHT, v04: V04_WEIGHT },
      calibration: false,
      ...metrics,
      by_type: byType
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/data-quality', (req, res) => {
  try {
    const competitions = db.prepare(`
      SELECT
        competition,
        COUNT(*) AS total_matches,

        SUM(
          CASE
            WHEN LOWER(status) = 'finished'
              AND home_score IS NOT NULL
              AND away_score IS NOT NULL
            THEN 1 ELSE 0
          END
        ) AS finished_with_score,

        SUM(
          CASE
            WHEN LOWER(status) IN ('scheduled', 'timed')
            THEN 1 ELSE 0
          END
        ) AS upcoming_matches,

        SUM(
          CASE
            WHEN LOWER(status) IN ('scheduled', 'timed')
              AND (
                home_score IS NOT NULL
                OR away_score IS NOT NULL
              )
            THEN 1 ELSE 0
          END
        ) AS upcoming_with_scores

      FROM matches
      GROUP BY competition
      ORDER BY competition
    `).all();

    const teamRows = db.prepare(`
      SELECT competition, home_team AS team
      FROM matches

      UNION

      SELECT competition, away_team AS team
      FROM matches

      ORDER BY competition, team
    `).all();

    const teamsByCompetition = {};

    for (const row of teamRows) {
      if (!teamsByCompetition[row.competition]) {
        teamsByCompetition[row.competition] = [];
      }

      teamsByCompetition[row.competition].push(row.team);
    }

    const sourceCounts = db.prepare(`
      SELECT
        COALESCE(source, 'unknown') AS source,
        COUNT(*) AS matches
      FROM matches
      GROUP BY source
      ORDER BY source
    `).all();

    const providerMappings = db.prepare(`
      SELECT
        provider,
        COUNT(*) AS mappings
      FROM match_sources
      GROUP BY provider
      ORDER BY provider
    `).all();

    const duplicates = db.prepare(`
      SELECT
        competition,
        home_team,
        away_team,
        kickoff,
        COUNT(*) AS duplicate_count
      FROM matches
      GROUP BY competition, home_team, away_team, kickoff
      HAVING COUNT(*) > 1
      ORDER BY duplicate_count DESC
      LIMIT 50
    `).all();

    res.json({
      checked_at: now(),
      competitions: competitions.map((competition) => ({
        ...competition,
        teams: teamsByCompetition[competition.competition] || [],
        unique_team_count: (
          teamsByCompetition[competition.competition] || []
        ).length
      })),
      source_counts: sourceCounts,
      provider_mappings: providerMappings,
      duplicate_fixtures: duplicates
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/model', (req, res) => {
  res.json({
    model: MODEL_VERSION,
    components: {
      V02: V02_WEIGHT,
      V04: V04_WEIGHT
    },
    threshold: HISTORY_THRESHOLD,
    calibration: {
      enabled: false,
      method: null
    },
    fallback: FALLBACK_MODEL_VERSION,
    productionChange: true,
    database: 'SQLite',
    evaluation: {
      live: 'Prediksi yang dibuat untuk pertandingan mendatang',
      backtest: 'Prediksi historis menggunakan pertandingan sebelumnya saja'
    }
  });
});

app.post('/api/admin/sync', async (req, res) => {
const configuredToken = process.env.ADMIN_TOKEN;
const suppliedToken = req.get('x-admin-token') || '';

if (!configuredToken) {
return res.status(503).json({
error: 'Admin authentication is not configured.'
});
}

const expected = Buffer.from(configuredToken, 'utf8');
const supplied = Buffer.from(suppliedToken, 'utf8');

if (
expected.length !== supplied.length ||
!crypto.timingSafeEqual(expected, supplied)
) {
return res.status(401).json({
error: 'Unauthorized.'
});
}

try {
res.json(await sync());
} catch (error) {
console.error('[manual-sync]', error);
res.status(500).json({
error: 'Manual sync failed.'
});
}
});

// ============================================================
// AUTOMATED SYNC
// ============================================================

if (process.env.SKIP_AUTOMATIC_SYNC !== 'true') cron.schedule(
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

  if (process.env.SKIP_AUTOMATIC_SYNC === 'true') {
    const pipeline = runPredictionPipeline();
    console.log('[startup] sync skipped; prediction pipeline completed', pipeline);
  } else {
    sync()
      .then((data) => {
        console.log('[startup] sync completed', data);
      })
      .catch((error) => {
        console.error('[startup]', error.message);
      });
  }
});

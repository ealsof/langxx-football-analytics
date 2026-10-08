import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const db = new Database(
  path.join(__dirname, 'football.db')
);

db.pragma('journal_mode = WAL');

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

INSERT OR IGNORE INTO model_versions(
  version,
  status,
  created_at,
  notes
)
VALUES(
  'v0.1',
  'legacy',
  datetime('now'),
  'Original baseline architecture'
);

INSERT OR IGNORE INTO model_versions(
  version,
  status,
  created_at,
  notes
)
VALUES(
  'ensemble_60_40',
  'production',
  datetime('now'),
  'Production model: V0.2 60% + V0.4 40%, minimum 30 prior same-competition matches, calibration OFF'
);
`);

app.use(express.json());
app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

// ============================================================
// PRODUCTION MODEL CONFIG
// ============================================================

const MODEL_VERSION =
  'ensemble_60_40';

const FALLBACK_MODEL_VERSION =
  'v0.1-fallback';

const HISTORY_THRESHOLD =
  30;

const V02_WEIGHT =
  0.60;

const V04_WEIGHT =
  0.40;

// V0.1 fallback constants.
// Hanya digunakan jika history < 30 pertandingan.
const FALLBACK_HOME_PROB =
  0.45;

const FALLBACK_DRAW_PROB =
  0.27;

const FALLBACK_AWAY_PROB =
  0.28;

const FALLBACK_HOME_GOALS =
  1.55;

const FALLBACK_AWAY_GOALS =
  1.05;

// ============================================================
// HELPERS
// ============================================================

const now = () =>
  new Date().toISOString();

function result(home, away) {
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
}

function factorial(n) {
  if (n <= 1) {
    return 1;
  }

  let value = 1;

  for (
    let i = 2;
    i <= n;
    i++
  ) {
    value *= i;
  }

  return value;
}

function poisson(lambda, k) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial(k)
  );
}

function clip(
  value,
  min,
  max
) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function normalizeProbabilities(
  home,
  draw,
  away
) {
  const total =
    home +
    draw +
    away;

  if (
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return {
      home,
      draw,
      away
    };
  }

  return {
    home: home / total,
    draw: draw / total,
    away: away / total
  };
}

function poissonPrediction(
  homeGoals,
  awayGoals
) {
  const maxGoals = 10;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestProbability = -1;
  let bestHome = 0;
  let bestAway = 0;

  for (
    let h = 0;
    h <= maxGoals;
    h++
  ) {
    for (
      let a = 0;
      a <= maxGoals;
      a++
    ) {
      const probability =
        poisson(
          homeGoals,
          h
        ) *
        poisson(
          awayGoals,
          a
        );

      if (h > a) {
        homeWin += probability;
      } else if (h === a) {
        draw += probability;
      } else {
        awayWin += probability;
      }

      if (
        probability >
        bestProbability
      ) {
        bestProbability =
          probability;

        bestHome = h;
        bestAway = a;
      }
    }
  }

  const probabilities =
    normalizeProbabilities(
      homeWin,
      draw,
      awayWin
    );

  const predictedResult =
    probabilities.home >=
      probabilities.draw &&
    probabilities.home >=
      probabilities.away
      ? 'H'
      : probabilities.draw >=
        probabilities.away
        ? 'D'
        : 'A';

  return {
    homeProb:
      probabilities.home,

    drawProb:
      probabilities.draw,

    awayProb:
      probabilities.away,

    predictedHomeGoals:
      homeGoals,

    predictedAwayGoals:
      awayGoals,

    predictedResult,

    exactHomeGoals:
      bestHome,

    exactAwayGoals:
      bestAway
  };
}

// ============================================================
// V0.2
// ALL-HISTORY SAME-COMPETITION
// TEAM GF/GA + LEAGUE HOME/AWAY SCORING
// ============================================================

function predictV02(
  target,
  priorMatches
) {
  const finished =
    priorMatches.filter(
      match =>
        match.home_score !== null &&
        match.away_score !== null
    );

  if (
    finished.length <
    HISTORY_THRESHOLD
  ) {
    return null;
  }

  let leagueHomeGoals = 0;
  let leagueAwayGoals = 0;

  let homeGames = 0;
  let awayGames = 0;

  let homeGoalsFor = 0;
  let homeGoalsAgainst = 0;

  let awayGoalsFor = 0;
  let awayGoalsAgainst = 0;

  for (
    const match of finished
  ) {
    const homeScore =
      Number(
        match.home_score
      );

    const awayScore =
      Number(
        match.away_score
      );

    leagueHomeGoals +=
      homeScore;

    leagueAwayGoals +=
      awayScore;

    if (
      match.home_team ===
      target.home_team
    ) {
      homeGames++;

      homeGoalsFor +=
        homeScore;

      homeGoalsAgainst +=
        awayScore;
    }

    if (
      match.away_team ===
      target.home_team
    ) {
      homeGames++;

      homeGoalsFor +=
        awayScore;

      homeGoalsAgainst +=
        homeScore;
    }

    if (
      match.home_team ===
      target.away_team
    ) {
      awayGames++;

      awayGoalsFor +=
        homeScore;

      awayGoalsAgainst +=
        awayScore;
    }

    if (
      match.away_team ===
      target.away_team
    ) {
      awayGames++;

      awayGoalsFor +=
        awayScore;

      awayGoalsAgainst +=
        homeScore;
    }
  }

  if (
    homeGames === 0 ||
    awayGames === 0
  ) {
    return null;
  }

  const leagueHomeAverage =
    leagueHomeGoals /
    finished.length;

  const leagueAwayAverage =
    leagueAwayGoals /
    finished.length;

  if (
    leagueHomeAverage <= 0 ||
    leagueAwayAverage <= 0
  ) {
    return null;
  }

  const homeAttack =
    homeGoalsFor /
    Math.max(
      leagueHomeAverage *
        homeGames,
      0.1
    );

  const awayAttack =
    awayGoalsFor /
    Math.max(
      leagueAwayAverage *
        awayGames,
      0.1
    );

  const homeDefense =
    homeGoalsAgainst /
    Math.max(
      leagueAwayAverage *
        homeGames,
      0.1
    );

  const awayDefense =
    awayGoalsAgainst /
    Math.max(
      leagueHomeAverage *
        awayGames,
      0.1
    );

  let homeGoals =
    leagueHomeAverage *
    homeAttack *
    awayDefense;

  let awayGoals =
    leagueAwayAverage *
    awayAttack *
    homeDefense;

  homeGoals *= 1.05;

  homeGoals =
    clip(
      homeGoals,
      0.2,
      4.5
    );

  awayGoals =
    clip(
      awayGoals,
      0.2,
      4.5
    );

  return poissonPrediction(
    homeGoals,
    awayGoals
  );
}

// ============================================================
// V0.4
// ELO
// ============================================================

function eloExpected(
  ratingA,
  ratingB
) {
  return (
    1 /
    (
      1 +
      Math.pow(
        10,
        (ratingB - ratingA) /
          400
      )
    )
  );
}

function eloMarginMultiplier(
  goalMargin
) {
  if (
    goalMargin <= 1
  ) {
    return 1;
  }

  if (
    goalMargin === 2
  ) {
    return 1.25;
  }

  return 1.5;
}

function predictV04(
  target,
  priorMatches
) {
  const finished =
    priorMatches
      .filter(
        match =>
          match.home_score !== null &&
          match.away_score !== null
      )
      .sort(
        (a, b) =>
          new Date(
            a.kickoff
          ).getTime() -
          new Date(
            b.kickoff
          ).getTime()
      );

  if (
    finished.length <
    HISTORY_THRESHOLD
  ) {
    return null;
  }

  const ratings =
    new Map();

  function getRating(team) {
    if (
      !ratings.has(team)
    ) {
      ratings.set(
        team,
        1500
      );
    }

    return ratings.get(
      team
    );
  }

  function setRating(
    team,
    rating
  ) {
    ratings.set(
      team,
      rating
    );
  }

  for (
    const match of finished
  ) {
    const home =
      match.home_team;

    const away =
      match.away_team;

    const homeScore =
      Number(
        match.home_score
      );

    const awayScore =
      Number(
        match.away_score
      );

    const homeRating =
      getRating(home);

    const awayRating =
      getRating(away);

    const expectedHome =
      eloExpected(
        homeRating + 60,
        awayRating
      );

    const actualHome =
      homeScore >
      awayScore
        ? 1
        : homeScore ===
          awayScore
          ? 0.5
          : 0;

    const goalMargin =
      Math.abs(
        homeScore -
        awayScore
      );

    const multiplier =
      eloMarginMultiplier(
        goalMargin
      );

    const k =
      25 *
      multiplier;

    const homeNewRating =
      homeRating +
      k *
        (
          actualHome -
          expectedHome
        );

    const awayNewRating =
      awayRating +
      k *
        (
          (1 -
            actualHome) -
          (1 -
            expectedHome)
        );

    setRating(
      home,
      homeNewRating
    );

    setRating(
      away,
      awayNewRating
    );
  }

  const homeRating =
    getRating(
      target.home_team
    );

  const awayRating =
    getRating(
      target.away_team
    );

  const difference =
    homeRating +
    60 -
    awayRating;

  const homeFactor =
    clip(
      1 +
        difference /
          1000,
      0.65,
      1.35
    );

  const awayFactor =
    clip(
      1 -
        difference /
          1200,
      0.65,
      1.35
    );

  let leagueHomeGoals = 0;
  let leagueAwayGoals = 0;

  for (
    const match of finished
  ) {
    leagueHomeGoals +=
      Number(
        match.home_score
      );

    leagueAwayGoals +=
      Number(
        match.away_score
      );
  }

  const homeAverage =
    leagueHomeGoals /
    finished.length;

  const awayAverage =
    leagueAwayGoals /
    finished.length;

  let homeGoals =
    homeAverage *
    homeFactor;

  let awayGoals =
    awayAverage *
    awayFactor;

  homeGoals =
    clip(
      homeGoals,
      0.2,
      4.5
    );

  awayGoals =
    clip(
      awayGoals,
      0.2,
      4.5
    );

  return poissonPrediction(
    homeGoals,
    awayGoals
  );
}

// ============================================================
// ENSEMBLE 60:40
// ============================================================

function predictEnsemble(
  target,
  priorMatches
) {
  if (
    priorMatches.length <
    HISTORY_THRESHOLD
  ) {
    return null;
  }

  const v02 =
    predictV02(
      target,
      priorMatches
    );

  const v04 =
    predictV04(
      target,
      priorMatches
    );

  if (
    !v02 ||
    !v04
  ) {
    return null;
  }

  const homeProb =
    (
      V02_WEIGHT *
        v02.homeProb
    ) +
    (
      V04_WEIGHT *
        v04.homeProb
    );

  const drawProb =
    (
      V02_WEIGHT *
        v02.drawProb
    ) +
    (
      V04_WEIGHT *
        v04.drawProb
    );

  const awayProb =
    (
      V02_WEIGHT *
        v02.awayProb
    ) +
    (
      V04_WEIGHT *
        v04.awayProb
    );

  const probabilities =
    normalizeProbabilities(
      homeProb,
      drawProb,
      awayProb
    );

  const predictedResult =
    probabilities.home >=
      probabilities.draw &&
    probabilities.home >=
      probabilities.away
      ? 'H'
      : probabilities.draw >=
        probabilities.away
        ? 'D'
        : 'A';

  const predictedHomeGoals =
    (
      V02_WEIGHT *
        v02.predictedHomeGoals
    ) +
    (
      V04_WEIGHT *
        v04.predictedHomeGoals
    );

  const predictedAwayGoals =
    (
      V02_WEIGHT *
        v02.predictedAwayGoals
    ) +
    (
      V04_WEIGHT *
        v04.predictedAwayGoals
    );

  return {
    homeProb:
      probabilities.home,

    drawProb:
      probabilities.draw,

    awayProb:
      probabilities.away,

    predictedHomeGoals,

    predictedAwayGoals,

    predictedResult,

    modelVersion:
      MODEL_VERSION,

    components: {
      v02:
        V02_WEIGHT,

      v04:
        V04_WEIGHT
    },

    historyMatches:
      priorMatches.length
  };
}

// ============================================================
// FALLBACK
// ============================================================

function fallbackPrediction() {
  return {
    homeProb:
      FALLBACK_HOME_PROB,

    drawProb:
      FALLBACK_DRAW_PROB,

    awayProb:
      FALLBACK_AWAY_PROB,

    predictedHomeGoals:
      FALLBACK_HOME_GOALS,

    predictedAwayGoals:
      FALLBACK_AWAY_GOALS,

    predictedResult:
      'H',

    modelVersion:
      FALLBACK_MODEL_VERSION,

    components: {
      v02:
        0,

      v04:
        0
    },

    historyMatches:
      0
  };
}

// ============================================================
// PRIOR MATCHES
// ============================================================

function getPriorMatches(
  target
) {
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
      AND kickoff < ?
    ORDER BY kickoff ASC
  `).all(
    target.competition,
    target.kickoff
  );
}

// ============================================================
// CREATE PRODUCTION PREDICTIONS
// ============================================================

function createPredictions() {
  const matches =
    db.prepare(`
      SELECT *
      FROM matches
      WHERE kickoff > ?
        AND LOWER(status) IN (
          'scheduled',
          'timed'
        )
      ORDER BY kickoff ASC
    `).all(
      now()
    );

  const insert =
    db.prepare(`
      INSERT INTO predictions(
        match_id,
        model_version,
        created_at,
        home_prob,
        draw_prob,
        away_prob,
        predicted_home_goals,
        predicted_away_goals,
        predicted_result
      )
      VALUES(
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `);

  let ensembleCount = 0;
  let fallbackCount = 0;
  let skippedCount = 0;

  const transaction =
    db.transaction(() => {

      for (
        const match of matches
      ) {
        const existing =
          db.prepare(`
            SELECT
              1
            FROM predictions
            WHERE match_id = ?
              AND model_version = ?
            LIMIT 1
          `).get(
            match.id,
            MODEL_VERSION
          );

        if (existing) {
          skippedCount++;
          continue;
        }

        const priorMatches =
          getPriorMatches(
            match
          );

        let prediction =
          predictEnsemble(
            match,
            priorMatches
          );

        if (prediction) {
          ensembleCount++;
        } else {
          prediction =
            fallbackPrediction();

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
    });

  transaction();

  return {
    model:
      MODEL_VERSION,

    threshold:
      HISTORY_THRESHOLD,

    weights: {
      v02:
        V02_WEIGHT,

      v04:
        V04_WEIGHT
    },

    calibration:
      false,

    matchesChecked:
      matches.length,

    ensembleCreated:
      ensembleCount,

    fallbackCreated:
      fallbackCount,

    alreadyExisting:
      skippedCount
  };
}

// ============================================================
// EVALUATION
// ============================================================

function evaluateFinished() {
  const rows =
    db.prepare(`
      SELECT
        p.*,
        m.home_score,
        m.away_score
      FROM predictions p
      JOIN matches m
        ON m.id = p.match_id
      WHERE LOWER(m.status) = 'finished'
        AND m.home_score IS NOT NULL
        AND m.away_score IS NOT NULL
        AND p.model_version IN (
          'ensemble_60_40',
          'v0.1-fallback'
        )
        AND NOT EXISTS(
          SELECT 1
          FROM evaluations e
          WHERE e.prediction_id = p.id
        )
    `).all();

  const insert =
    db.prepare(`
      INSERT INTO evaluations(
        prediction_id,
        evaluated_at,
        actual_result,
        exact_score_hit,
        result_hit,
        home_goal_error,
        away_goal_error
      )
      VALUES(
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `);

  const transaction =
    db.transaction(() => {

      for (
        const row of rows
      ) {
        const actualResult =
          result(
            row.home_score,
            row.away_score
          );

        const predictedResult =
          row.predicted_result;

        const exactScoreHit =
          Math.round(
            row.predicted_home_goals
          ) ===
            row.home_score &&
          Math.round(
            row.predicted_away_goals
          ) ===
            row.away_score
            ? 1
            : 0;

        const resultHit =
          actualResult ===
          predictedResult
            ? 1
            : 0;

        const homeGoalError =
          Math.abs(
            row.predicted_home_goals -
            row.home_score
          );

        const awayGoalError =
          Math.abs(
            row.predicted_away_goals -
            row.away_score
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
    });

  transaction();

  return {
    evaluated:
      rows.length
  };
}

// ============================================================
// MOCK SYNC
// ============================================================

function mockSync() {
  const sample = [
    [
      1,
      'Arsenal',
      'Chelsea',
      'Premier League',
      new Date(
        Date.now() +
        86400000
      ).toISOString(),
      'scheduled'
    ],
    [
      2,
      'Liverpool',
      'Manchester United',
      'Premier League',
      new Date(
        Date.now() +
        172800000
      ).toISOString(),
      'scheduled'
    ],
    [
      3,
      'Barcelona',
      'Real Madrid',
      'La Liga',
      new Date(
        Date.now() +
        259200000
      ).toISOString(),
      'scheduled'
    ]
  ];

  const up =
    db.prepare(`
      INSERT INTO matches(
        id,
        home_team,
        away_team,
        competition,
        kickoff,
        status,
        source,
        updated_at
      )
      VALUES(
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
      ON CONFLICT(id)
      DO UPDATE SET
        home_team =
          excluded.home_team,
        away_team =
          excluded.away_team,
        competition =
          excluded.competition,
        kickoff =
          excluded.kickoff,
        status =
          excluded.status,
        updated_at =
          excluded.updated_at
    `);

  const transaction =
    db.transaction(() => {

      sample.forEach(
        row =>
          up.run(
            ...row,
            'mock',
            now()
          )
      );
    });

  transaction();

  const predictions =
    createPredictions();

  const evaluations =
    evaluateFinished();

  return {
    mode:
      'mock',

    predictions,
    evaluations
  };
}

// ============================================================
// REAL SYNC
// ============================================================

async function sync() {
  if (
    process.env.MOCK_MODE ===
    'true'
  ) {
    return mockSync();
  }

  const token =
    process.env.FOOTBALL_DATA_API_TOKEN;

  if (!token) {
    throw new Error(
      'FOOTBALL_DATA_API_TOKEN tidak ditemukan'
    );
  }

  const competitions = [
    {
      code: 'PL',
      name:
        'Premier League'
    },
    {
      code: 'PD',
      name:
        'La Liga'
    }
  ];

  const findSource =
    db.prepare(`
      SELECT match_id
      FROM match_sources
      WHERE provider = ?
        AND provider_match_id = ?
    `);

  const insertMatch =
    db.prepare(`
      INSERT INTO matches(
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
      VALUES(
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `);

  const insertSource =
    db.prepare(`
      INSERT INTO match_sources(
        match_id,
        provider,
        provider_match_id,
        created_at,
        updated_at
      )
      VALUES(
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `);

  let totalReceived = 0;
  let totalImported = 0;
  let totalExisting = 0;

  for (
    const competition of
    competitions
  ) {
    const url =
      `https://api.football-data.org/v4/competitions/${competition.code}/matches`;

    const response =
      await fetch(
        url,
        {
          headers: {
            'X-Auth-Token':
              token
          }
        }
      );

    if (!response.ok) {
      const body =
        await response.text();

      throw new Error(
        `football-data.org ${competition.code} HTTP ${response.status}: ${body}`
      );
    }

    const json =
      await response.json();

    const matches =
      Array.isArray(
        json.matches
      )
        ? json.matches
        : [];

    totalReceived +=
      matches.length;

    for (
      const match of
      matches
    ) {
      const providerMatchId =
        String(
          match.id
        );

      const existing =
        findSource.get(
          'football-data.org',
          providerMatchId
        );

      const homeScore =
        match.score?.fullTime?.home ??
        null;

      const awayScore =
        match.score?.fullTime?.away ??
        null;

      const status =
        match.status?.toLowerCase() ||
        'scheduled';

      if (existing) {
        db.prepare(`
          UPDATE matches
          SET
            status = ?,
            home_score = ?,
            away_score = ?,
            updated_at = ?
          WHERE id = ?
        `).run(
          status,
          homeScore,
          awayScore,
          now(),
          existing.match_id
        );

        db.prepare(`
          UPDATE match_sources
          SET updated_at = ?
          WHERE provider = ?
            AND provider_match_id = ?
        `).run(
          now(),
          'football-data.org',
          providerMatchId
        );

        totalExisting++;

        continue;
      }

      const homeTeam =
        match.homeTeam?.name ||
        'Unknown Home Team';

      const awayTeam =
        match.awayTeam?.name ||
        'Unknown Away Team';

      const kickoff =
        match.utcDate;

      const insertTransaction =
        db.transaction(() => {

          const result =
            insertMatch.run(
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

          const internalMatchId =
            Number(
              result.lastInsertRowid
            );

          insertSource.run(
            internalMatchId,
            'football-data.org',
            providerMatchId,
            now(),
            now()
          );
        });

      insertTransaction();

      totalImported++;
    }
  }

  const predictions =
    createPredictions();

  const evaluations =
    evaluateFinished();

  return {
    mode:
      'football-data.org',

    competitions:
      [
        'PL',
        'PD'
      ],

    fixtures_received:
      totalReceived,

    fixtures_imported:
      totalImported,

    fixtures_updated:
      totalExisting,

    predictions,

    evaluations
  };
}

// ============================================================
// API
// ============================================================

app.get(
  '/api/health',
  (req, res) => {
    res.json({
      ok:
        true,

      time:
        now(),

      automation:
        'enabled',

      mock:
        process.env.MOCK_MODE ===
        'true',

      productionModel:
        MODEL_VERSION,

      fallbackModel:
        FALLBACK_MODEL_VERSION,

      threshold:
        HISTORY_THRESHOLD,

      weights: {
        v02:
          V02_WEIGHT,

        v04:
          V04_WEIGHT
      },

      calibration:
        false
    });
  }
);

// ------------------------------------------------------------
// MATCHES
// ------------------------------------------------------------

app.get(
  '/api/matches',
  (req, res) => {
    const rows =
      db.prepare(`
        SELECT *
        FROM matches
        ORDER BY kickoff ASC
        LIMIT 100
      `).all();

    res.json(
      rows
    );
  }
);

// ------------------------------------------------------------
// PREDICTIONS
//
// Menampilkan prediksi TERBARU untuk setiap pertandingan.
// Prediksi v0.1 lama tidak dihapus dari database.
// ------------------------------------------------------------

app.get(
  '/api/predictions',
  (req, res) => {
    const rows =
      db.prepare(`
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
        JOIN matches m
          ON m.id = p.match_id
        WHERE p.id IN (
          SELECT MAX(p2.id)
          FROM predictions p2
          GROUP BY p2.match_id
        )
        AND m.kickoff >= datetime('now')
        AND m.status IN ('scheduled', 'timed')
        ORDER BY m.kickoff ASC
        LIMIT 100
      `).all();

    res.json(
      rows
    );
  }
);

// ------------------------------------------------------------
// EVALUATIONS
// ------------------------------------------------------------

app.get(
  '/api/evaluations',
  (req, res) => {

    const rows =
      db.prepare(`
        SELECT
          e.*,
          p.model_version,
          m.home_team,
          m.away_team,
          m.home_score,
          m.away_score
        FROM evaluations e
        JOIN predictions p
          ON p.id =
             e.prediction_id
        JOIN matches m
          ON m.id =
             p.match_id
        ORDER BY
          e.evaluated_at DESC
        LIMIT 100
      `).all();

    res.json(
      rows
    );
  }
);

// ------------------------------------------------------------
// METRICS
//
// Hanya metrics production model.
// ------------------------------------------------------------

app.get(
  '/api/metrics',
  (req, res) => {

    const production =
      db.prepare(`
        SELECT
          COUNT(*) AS n,

          COALESCE(
            AVG(result_hit),
            0
          ) AS accuracy,

          COALESCE(
            AVG(exact_score_hit),
            0
          ) AS exact_score,

          COALESCE(
            AVG(
              (
                home_goal_error +
                away_goal_error
              ) / 2.0
            ),
            0
          ) AS goal_mae

        FROM evaluations e
        JOIN predictions p
          ON p.id =
             e.prediction_id

        WHERE p.model_version IN (
          'ensemble_60_40',
          'v0.1-fallback'
        )
      `).get();

    res.json({
      model:
        MODEL_VERSION,

      threshold:
        HISTORY_THRESHOLD,

      weights: {
        v02:
          V02_WEIGHT,

        v04:
          V04_WEIGHT
      },

      calibration:
        false,

      ...production
    });
  }
);

// ------------------------------------------------------------
// MODEL INFO
// ------------------------------------------------------------

app.get(
  '/api/model',
  (req, res) => {
    res.json({
      model:
        MODEL_VERSION,

      components: {
        V02:
          V02_WEIGHT,

        V04:
          V04_WEIGHT
      },

      threshold:
        HISTORY_THRESHOLD,

      calibration: {
        enabled:
          false,

        method:
          null
      },

      fallback:
        FALLBACK_MODEL_VERSION,

      productionChange:
        true,

      database:
        'existing football.db'
    });
  }
);

// ------------------------------------------------------------
// SYNC
// ------------------------------------------------------------

app.post(
  '/api/admin/sync',
  async (req, res) => {
    try {
      const data =
        await sync();

      res.json(
        data
      );
    } catch (error) {
      res.status(500).json({
        error:
          error.message
      });
    }
  }
);

// ============================================================
// AUTOMATION
// ============================================================

cron.schedule(
  process.env.SYNC_CRON ||
    '*/15 * * * *',
  async () => {
    try {
      const data =
        await sync();

      console.log(
        `[automation] sync ${now()}`,
        data
      );
    } catch (error) {
      console.error(
        '[automation]',
        error.message
      );
    }
  }
);

// ============================================================
// INITIAL STARTUP
// ============================================================

sync()
  .then(
    data => {
      console.log(
        '[startup] sync completed',
        data
      );
    }
  )
  .catch(
    error => {
      console.error(
        '[startup]',
        error.message
      );
    }
  );

// ============================================================
// SERVER
// ============================================================

const port =
  Number(
    process.env.PORT ||
      3000
  );

app.listen(
  port,
  () => {
    console.log(
      `Football Analytics Lab: http://localhost:${port}`
    );

    console.log(
      `[model] ${MODEL_VERSION}`
    );

    console.log(
      `[model] V0.2=${V02_WEIGHT}, V0.4=${V04_WEIGHT}`
    );

    console.log(
      `[model] threshold=${HISTORY_THRESHOLD}`
    );

    console.log(
      '[model] calibration=OFF'
    );
  }
);
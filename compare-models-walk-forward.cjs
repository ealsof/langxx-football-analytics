const Database = require('better-sqlite3');

const db = new Database('./football.db', {
  readonly: true
});

// ============================================================
// CONFIG — SAMA DENGAN PRODUCTION
// ============================================================

const HISTORY_THRESHOLD = 30;

const V02_WEIGHT = 0.60;
const V04_WEIGHT = 0.40;

// ============================================================
// HELPERS
// ============================================================

function result(home, away) {
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
}

function factorial(n) {
  if (n <= 1) return 1;

  let value = 1;

  for (let i = 2; i <= n; i++) {
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

function clip(value, min, max) {
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

// ============================================================
// POISSON
// ============================================================

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

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const probability =
        poisson(homeGoals, h) *
        poisson(awayGoals, a);

      if (h > a) {
        homeWin += probability;
      } else if (h === a) {
        draw += probability;
      } else {
        awayWin += probability;
      }

      if (probability > bestProbability) {
        bestProbability = probability;
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

    predictedResult,

    exactHomeGoals: bestHome,
    exactAwayGoals: bestAway
  };
}

// ============================================================
// V0.2
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

  for (const match of finished) {
    const homeScore =
      Number(match.home_score);

    const awayScore =
      Number(match.away_score);

    leagueHomeGoals += homeScore;
    leagueAwayGoals += awayScore;

    if (
      match.home_team ===
      target.home_team
    ) {
      homeGames++;

      homeGoalsFor += homeScore;
      homeGoalsAgainst += awayScore;
    }

    if (
      match.away_team ===
      target.home_team
    ) {
      homeGames++;

      homeGoalsFor += awayScore;
      homeGoalsAgainst += homeScore;
    }

    if (
      match.home_team ===
      target.away_team
    ) {
      awayGames++;

      awayGoalsFor += homeScore;
      awayGoalsAgainst += awayScore;
    }

    if (
      match.away_team ===
      target.away_team
    ) {
      awayGames++;

      awayGoalsFor += awayScore;
      awayGoalsAgainst += homeScore;
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

  homeGoals = clip(
    homeGoals,
    0.2,
    4.5
  );

  awayGoals = clip(
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
// V0.4 ELO
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
  if (goalMargin <= 1) {
    return 1;
  }

  if (goalMargin === 2) {
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
          new Date(a.kickoff).getTime() -
          new Date(b.kickoff).getTime()
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
    if (!ratings.has(team)) {
      ratings.set(team, 1500);
    }

    return ratings.get(team);
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

  for (const match of finished) {
    const home =
      match.home_team;

    const away =
      match.away_team;

    const homeScore =
      Number(match.home_score);

    const awayScore =
      Number(match.away_score);

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
      homeScore > awayScore
        ? 1
        : homeScore === awayScore
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
      25 * multiplier;

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
          (1 - actualHome) -
          (1 - expectedHome)
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

  for (const match of finished) {
    leagueHomeGoals +=
      Number(match.home_score);

    leagueAwayGoals +=
      Number(match.away_score);
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

  homeGoals = clip(
    homeGoals,
    0.2,
    4.5
  );

  awayGoals = clip(
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
// ENSEMBLE
// ============================================================

function predictEnsemble(
  v02,
  v04
) {
  if (!v02 || !v04) {
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
    probabilities.home >= probabilities.draw &&
    probabilities.home >= probabilities.away
      ? 'H'
      : probabilities.draw >= probabilities.away
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

    predictedResult
  };
}

// ============================================================
// METRIC HELPERS
// ============================================================

function brier(
  prediction,
  actual
) {
  const h =
    actual === 'H' ? 1 : 0;

  const d =
    actual === 'D' ? 1 : 0;

  const a =
    actual === 'A' ? 1 : 0;

  return (
    Math.pow(
      prediction.homeProb - h,
      2
    ) +

    Math.pow(
      prediction.drawProb - d,
      2
    ) +

    Math.pow(
      prediction.awayProb - a,
      2
    )
  ) / 3;
}

function evaluatePrediction(
  prediction,
  target
) {
  const actual =
    result(
      Number(target.home_score),
      Number(target.away_score)
    );

  return {
    actual,

    resultHit:
      prediction.predictedResult ===
      actual
        ? 1
        : 0,

    exactScoreHit:
      Math.round(
        prediction.predictedHomeGoals
      ) ===
        Number(target.home_score) &&
      Math.round(
        prediction.predictedAwayGoals
      ) ===
        Number(target.away_score)
        ? 1
        : 0,

    homeGoalError:
      Math.abs(
        prediction.predictedHomeGoals -
        Number(target.home_score)
      ),

    awayGoalError:
      Math.abs(
        prediction.predictedAwayGoals -
        Number(target.away_score)
      ),

    brier:
      brier(
        prediction,
        actual
      )
  };
}

function calculateMetrics(rows) {
  if (!rows.length) {
    return null;
  }

  return {
    n: rows.length,

    accuracy:
      rows.reduce(
        (sum, row) =>
          sum + row.resultHit,
        0
      ) /
      rows.length,

    exactScore:
      rows.reduce(
        (sum, row) =>
          sum + row.exactScoreHit,
        0
      ) /
      rows.length,

    mae:
      rows.reduce(
        (sum, row) =>
          sum +
          (
            row.homeGoalError +
            row.awayGoalError
          ) / 2,
        0
      ) /
      rows.length,

    brier:
      rows.reduce(
        (sum, row) =>
          sum + row.brier,
        0
      ) /
      rows.length
  };
}

function createConfusionMatrix(rows) {
  const matrix = {
    H: {
      H: 0,
      D: 0,
      A: 0
    },

    D: {
      H: 0,
      D: 0,
      A: 0
    },

    A: {
      H: 0,
      D: 0,
      A: 0
    }
  };

  for (const row of rows) {
    matrix[row.actual][
      row.prediction
    ]++;
  }

  return matrix;
}

function predictionDistribution(
  rows
) {
  return rows.reduce(
    (acc, row) => {
      acc[row.prediction]++;
      return acc;
    },
    {
      H: 0,
      D: 0,
      A: 0
    }
  );
}

// ============================================================
// DATA
// ============================================================

function getFinishedMatches() {
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
    ORDER BY kickoff ASC, id ASC
  `).all();
}

// ============================================================
// RUN COMPARISON
// ============================================================

function runComparison() {
  const matches =
    getFinishedMatches();

  const results = {
    v02: [],
    v04: [],
    ensemble: []
  };

  let validTargets = 0;
  let skipped = 0;

  for (const target of matches) {
    const priorMatches =
      matches.filter(
        match =>
          match.competition ===
            target.competition &&
          new Date(match.kickoff).getTime() <
            new Date(target.kickoff).getTime()
      );

    if (
      priorMatches.length <
      HISTORY_THRESHOLD
    ) {
      skipped++;
      continue;
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

    const ensemble =
      predictEnsemble(
        v02,
        v04
      );

    if (
      !v02 ||
      !v04 ||
      !ensemble
    ) {
      skipped++;
      continue;
    }

    validTargets++;

    const actual =
      result(
        Number(target.home_score),
        Number(target.away_score)
      );

    const predictions = [
      {
        key: 'v02',
        prediction: v02
      },

      {
        key: 'v04',
        prediction: v04
      },

      {
        key: 'ensemble',
        prediction: ensemble
      }
    ];

    for (const item of predictions) {
      const evaluation =
        evaluatePrediction(
          item.prediction,
          target
        );

      results[item.key].push({
        actual:
          evaluation.actual,

        prediction:
          item.prediction.predictedResult,

        resultHit:
          evaluation.resultHit,

        exactScoreHit:
          evaluation.exactScoreHit,

        homeGoalError:
          evaluation.homeGoalError,

        awayGoalError:
          evaluation.awayGoalError,

        brier:
          evaluation.brier
      });
    }
  }

  return {
    matches,
    results,
    validTargets,
    skipped
  };
}

// ============================================================
// MAIN
// ============================================================

try {
  console.log(
    '\n=================================================='
  );

  console.log(
    'FOOTBALL ANALYTICS LAB'
  );

  console.log(
    'WALK-FORWARD MODEL COMPARISON'
  );

  console.log(
    'V0.2 vs V0.4 vs ENSEMBLE 60:40'
  );

  console.log(
    '==================================================\n'
  );

  const {
    matches,
    results,
    validTargets,
    skipped
  } =
    runComparison();

  console.log(
    '=== DATASET ===\n'
  );

  console.log(
    `Finished matches found : ${matches.length}`
  );

  console.log(
    `Valid targets          : ${validTargets}`
  );

  console.log(
    `Skipped                : ${skipped}`
  );

  const v02Metrics =
    calculateMetrics(
      results.v02
    );

  const v04Metrics =
    calculateMetrics(
      results.v04
    );

  const ensembleMetrics =
    calculateMetrics(
      results.ensemble
    );

  console.log(
    '\n=== MODEL COMPARISON ===\n'
  );

  console.table([
    {
      model:
        'V0.2',

      samples:
        v02Metrics?.n ?? 0,

      accuracy:
        v02Metrics
          ? `${(
              v02Metrics.accuracy *
              100
            ).toFixed(2)}%`
          : 'N/A',

      exact_score:
        v02Metrics
          ? `${(
              v02Metrics.exactScore *
              100
            ).toFixed(2)}%`
          : 'N/A',

      mae:
        v02Metrics
          ? v02Metrics.mae.toFixed(4)
          : 'N/A',

      brier:
        v02Metrics
          ? v02Metrics.brier.toFixed(4)
          : 'N/A'
    },

    {
      model:
        'V0.4',

      samples:
        v04Metrics?.n ?? 0,

      accuracy:
        v04Metrics
          ? `${(
              v04Metrics.accuracy *
              100
            ).toFixed(2)}%`
          : 'N/A',

      exact_score:
        v04Metrics
          ? `${(
              v04Metrics.exactScore *
              100
            ).toFixed(2)}%`
          : 'N/A',

      mae:
        v04Metrics
          ? v04Metrics.mae.toFixed(4)
          : 'N/A',

      brier:
        v04Metrics
          ? v04Metrics.brier.toFixed(4)
          : 'N/A'
    },

    {
      model:
        'Ensemble 60:40',

      samples:
        ensembleMetrics?.n ?? 0,

      accuracy:
        ensembleMetrics
          ? `${(
              ensembleMetrics.accuracy *
              100
            ).toFixed(2)}%`
          : 'N/A',

      exact_score:
        ensembleMetrics
          ? `${(
              ensembleMetrics.exactScore *
              100
            ).toFixed(2)}%`
          : 'N/A',

      mae:
        ensembleMetrics
          ? ensembleMetrics.mae.toFixed(4)
          : 'N/A',

      brier:
        ensembleMetrics
          ? ensembleMetrics.brier.toFixed(4)
          : 'N/A'
    }
  ]);

  // ==========================================================
  // CONFUSION MATRIX
  // ==========================================================

  for (const [key, label] of [
    ['v02', 'V0.2'],
    ['v04', 'V0.4'],
    ['ensemble', 'Ensemble 60:40']
  ]) {
    console.log(
      `\n=== CONFUSION MATRIX — ${label} ===\n`
    );

    const matrixRows = results[key].map(
      row => ({
        actual:
          row.actual,

        prediction:
          row.prediction
      })
    );

    console.table(
      createConfusionMatrix(
        matrixRows
      )
    );

    console.log(
      `Prediction distribution — ${label}`
    );

    console.table(
      predictionDistribution(
        matrixRows
      )
    );
  }

  // ==========================================================
  // ACTUAL DISTRIBUTION
  // ==========================================================

  const actualDistribution =
    results.ensemble.reduce(
      (acc, row) => {
        acc[row.actual]++;
        return acc;
      },
      {
        H: 0,
        D: 0,
        A: 0
      }
    );

  console.log(
    '\n=== ACTUAL RESULT DISTRIBUTION ===\n'
  );

  console.table(
    actualDistribution
  );

  // ==========================================================
  // ENSEMBLE VS COMPONENTS
  // ==========================================================

  console.log(
    '\n=== ENSEMBLE IMPROVEMENT ===\n'
  );

  if (
    v02Metrics &&
    v04Metrics &&
    ensembleMetrics
  ) {
    console.log(
      `Accuracy vs V0.2 : ${(
        (
          ensembleMetrics.accuracy -
          v02Metrics.accuracy
        ) *
        100
      ).toFixed(2)} pp`
    );

    console.log(
      `Accuracy vs V0.4 : ${(
        (
          ensembleMetrics.accuracy -
          v04Metrics.accuracy
        ) *
        100
      ).toFixed(2)} pp`
    );

    console.log(
      `MAE vs V0.2      : ${(
        ensembleMetrics.mae -
        v02Metrics.mae
      ).toFixed(4)}`
    );

    console.log(
      `MAE vs V0.4      : ${(
        ensembleMetrics.mae -
        v04Metrics.mae
      ).toFixed(4)}`
    );

    console.log(
      `Brier vs V0.2    : ${(
        ensembleMetrics.brier -
        v02Metrics.brier
      ).toFixed(4)}`
    );

    console.log(
      `Brier vs V0.4    : ${(
        ensembleMetrics.brier -
        v04Metrics.brier
      ).toFixed(4)}`
    );
  }

  console.log(
    '\n=================================================='
  );

  console.log(
    'COMPARISON SELESAI'
  );

  console.log(
    'Database tidak diubah.'
  );

  console.log(
    '==================================================\n'
  );

} catch (error) {
  console.error(
    '\nComparison gagal:',
    error.message
  );

  process.exitCode = 1;
} finally {
  db.close();
}
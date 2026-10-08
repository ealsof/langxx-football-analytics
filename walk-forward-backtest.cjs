const Database = require('better-sqlite3');

const db = new Database('./football.db', {
  readonly: true
});

// ============================================================
// CONFIG — HARUS SAMA DENGAN PRODUCTION
// ============================================================

const HISTORY_THRESHOLD = 30;

const V02_WEIGHT = 0.60;
const V04_WEIGHT = 0.40;

const MODEL_VERSION = 'ensemble_60_40';

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
// Sama dengan production server.js
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
// ALL-HISTORY SAME-COMPETITION
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

    // TARGET HOME TEAM

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

    // TARGET AWAY TEAM

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

  // HOME BONUS
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
// Sama dengan production server.js
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

  // BUILD ELO CHRONOLOGICALLY
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

    predictedResult,

    historyMatches:
      priorMatches.length
  };
}

// ============================================================
// LOAD FINISHED MATCHES
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
// BRIER SCORE
// ============================================================

function brierScore(
  prediction,
  actual
) {
  const actualHome =
    actual === 'H' ? 1 : 0;

  const actualDraw =
    actual === 'D' ? 1 : 0;

  const actualAway =
    actual === 'A' ? 1 : 0;

  return (
    Math.pow(
      prediction.homeProb -
        actualHome,
      2
    ) +

    Math.pow(
      prediction.drawProb -
        actualDraw,
      2
    ) +

    Math.pow(
      prediction.awayProb -
        actualAway,
      2
    )
  );
}

// ============================================================
// WALK-FORWARD BACKTEST
// ============================================================

function runBacktest() {
  const matches =
    getFinishedMatches();

  const evaluated = [];

  let skipped =
    0;

  for (const target of matches) {
    /*
     * SANGAT PENTING:
     *
     * Hanya pertandingan yang kickoff-nya
     * SEBELUM pertandingan target yang boleh
     * masuk ke training/history.
     *
     * Pertandingan dengan kickoff sama tidak
     * boleh digunakan.
     */
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

    const prediction =
      predictEnsemble(
        target,
        priorMatches
      );

    if (!prediction) {
      skipped++;
      continue;
    }

    const actualResult =
      result(
        Number(target.home_score),
        Number(target.away_score)
      );

    const resultHit =
      prediction.predictedResult ===
      actualResult
        ? 1
        : 0;

    const homeGoalError =
      Math.abs(
        prediction.predictedHomeGoals -
        Number(target.home_score)
      );

    const awayGoalError =
      Math.abs(
        prediction.predictedAwayGoals -
        Number(target.away_score)
      );

    /*
     * Sama dengan evaluation production:
     * predicted goals dibulatkan untuk
     * exact-score classification.
     */
    const exactScoreHit =
      Math.round(
        prediction.predictedHomeGoals
      ) ===
        Number(target.home_score) &&
      Math.round(
        prediction.predictedAwayGoals
      ) ===
        Number(target.away_score)
        ? 1
        : 0;

    const brier =
      brierScore(
        prediction,
        actualResult
      );

    evaluated.push({
      id: target.id,

      home_team:
        target.home_team,

      away_team:
        target.away_team,

      competition:
        target.competition,

      kickoff:
        target.kickoff,

      actual_home:
        Number(target.home_score),

      actual_away:
        Number(target.away_score),

      actual_result:
        actualResult,

      predicted_result:
        prediction.predictedResult,

      home_prob:
        prediction.homeProb,

      draw_prob:
        prediction.drawProb,

      away_prob:
        prediction.awayProb,

      predicted_home_goals:
        prediction.predictedHomeGoals,

      predicted_away_goals:
        prediction.predictedAwayGoals,

      result_hit:
        resultHit,

      exact_score_hit:
        exactScoreHit,

      home_goal_error:
        homeGoalError,

      away_goal_error:
        awayGoalError,

      brier_score:
        brier,

      history_matches:
        priorMatches.length
    });
  }

  return {
    matches,
    evaluated,
    skipped
  };
}

// ============================================================
// METRICS
// ============================================================

function calculateMetrics(rows) {
  if (rows.length === 0) {
    return null;
  }

  const accuracy =
    rows.reduce(
      (sum, row) =>
        sum + row.result_hit,
      0
    ) / rows.length;

  const exactScore =
    rows.reduce(
      (sum, row) =>
        sum + row.exact_score_hit,
      0
    ) / rows.length;

  const mae =
    rows.reduce(
      (sum, row) =>
        sum +
        (
          row.home_goal_error +
          row.away_goal_error
        ) / 2,
      0
    ) / rows.length;

  const brier =
    rows.reduce(
      (sum, row) =>
        sum + row.brier_score,
      0
    ) / rows.length;

  return {
    n: rows.length,
    accuracy,
    exactScore,
    mae,
    brier
  };
}

// ============================================================
// CONFUSION MATRIX
// ============================================================

function confusionMatrix(rows) {
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
    matrix[row.actual_result][
      row.predicted_result
    ]++;
  }

  return matrix;
}

// ============================================================
// RESULT DISTRIBUTION
// ============================================================

function distribution(rows) {
  const actual = {
    H: 0,
    D: 0,
    A: 0
  };

  const predicted = {
    H: 0,
    D: 0,
    A: 0
  };

  for (const row of rows) {
    actual[row.actual_result]++;
    predicted[row.predicted_result]++;
  }

  return {
    actual,
    predicted
  };
}

// ============================================================
// DRAW CALIBRATION
// ============================================================

function drawCalibration(rows) {
  const buckets = [
    {
      label: '0-10%',
      min: 0,
      max: 0.10,
      count: 0,
      actualDraws: 0,
      probabilitySum: 0
    },

    {
      label: '10-20%',
      min: 0.10,
      max: 0.20,
      count: 0,
      actualDraws: 0,
      probabilitySum: 0
    },

    {
      label: '20-30%',
      min: 0.20,
      max: 0.30,
      count: 0,
      actualDraws: 0,
      probabilitySum: 0
    },

    {
      label: '30-40%',
      min: 0.30,
      max: 0.40,
      count: 0,
      actualDraws: 0,
      probabilitySum: 0
    },

    {
      label: '40%+',
      min: 0.40,
      max: Infinity,
      count: 0,
      actualDraws: 0,
      probabilitySum: 0
    }
  ];

  for (const row of rows) {
    const bucket =
      buckets.find(
        item =>
          row.draw_prob >= item.min &&
          row.draw_prob < item.max
      );

    if (!bucket) {
      continue;
    }

    bucket.count++;

    bucket.probabilitySum +=
      row.draw_prob;

    if (
      row.actual_result === 'D'
    ) {
      bucket.actualDraws++;
    }
  }

  return buckets.map(
    bucket => ({
      bucket: bucket.label,

      n: bucket.count,

      average_draw_probability:
        bucket.count > 0
          ? bucket.probabilitySum /
            bucket.count
          : 0,

      actual_draw_rate:
        bucket.count > 0
          ? bucket.actualDraws /
            bucket.count
          : 0
    })
  );
}

// ============================================================
// COMPETITION BREAKDOWN
// ============================================================

function competitionMetrics(rows) {
  const competitions = [
    ...new Set(
      rows.map(
        row => row.competition
      )
    )
  ];

  return competitions.map(
    competition => {
      const subset =
        rows.filter(
          row =>
            row.competition ===
            competition
        );

      return {
        competition,

        n: subset.length,

        accuracy:
          subset.reduce(
            (sum, row) =>
              sum + row.result_hit,
            0
          ) /
          subset.length,

        mae:
          subset.reduce(
            (sum, row) =>
              sum +
              (
                row.home_goal_error +
                row.away_goal_error
              ) / 2,
            0
          ) /
          subset.length,

        brier:
          subset.reduce(
            (sum, row) =>
              sum +
              row.brier_score,
            0
          ) /
          subset.length
      };
    }
  );
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
    'WALK-FORWARD BACKTEST'
  );

  console.log(
    'MODEL: ensemble_60_40'
  );

  console.log(
    'V0.2 = 60% | V0.4 = 40%'
  );

  console.log(
    'HISTORY THRESHOLD = 30'
  );

  console.log(
    '==================================================\n'
  );

  const {
    matches,
    evaluated,
    skipped
  } = runBacktest();

  const metrics =
    calculateMetrics(
      evaluated
    );

  console.log(
    '=== DATASET ===\n'
  );

  console.log(
    `Finished matches found : ${matches.length}`
  );

  console.log(
    `Valid rows evaluated   : ${evaluated.length}`
  );

  console.log(
    `Rows skipped            : ${skipped}`
  );

  if (!metrics) {
    console.log(
      '\nTidak ada sampel valid.'
    );

    process.exitCode = 0;
  } else {
    console.log(
      '\n=== OVERALL METRICS ===\n'
    );

    console.log(
      `Model              : ${MODEL_VERSION}`
    );

    console.log(
      `Samples            : ${metrics.n}`
    );

    console.log(
      `Accuracy 1X2       : ${(metrics.accuracy * 100).toFixed(2)}%`
    );

    console.log(
      `Exact score hit    : ${(metrics.exactScore * 100).toFixed(2)}%`
    );

    console.log(
      `Goal MAE           : ${metrics.mae.toFixed(4)}`
    );

    console.log(
      `Brier Score        : ${metrics.brier.toFixed(4)}`
    );

    console.log(
      '\n=== RESULT DISTRIBUTION ===\n'
    );

    const dist =
      distribution(
        evaluated
      );

    console.log(
      'Actual :'
    );

    console.table(
      dist.actual
    );

    console.log(
      'Predicted :'
    );

    console.table(
      dist.predicted
    );

    console.log(
      '\n=== CONFUSION MATRIX ===\n'
    );

    console.log(
      'Rows = actual'
    );

    console.log(
      'Columns = predicted'
    );

    console.table(
      confusionMatrix(
        evaluated
      )
    );

    console.log(
      '\n=== COMPETITION BREAKDOWN ===\n'
    );

    console.table(
      competitionMetrics(
        evaluated
      )
    );

    console.log(
      '\n=== DRAW CALIBRATION ===\n'
    );

    console.table(
      drawCalibration(
        evaluated
      )
    );

    console.log(
      '\n=== FIRST 10 WALK-FORWARD PREDICTIONS ===\n'
    );

    console.table(
      evaluated
        .slice(0, 10)
        .map(row => ({
          kickoff:
            row.kickoff,

          home:
            row.home_team,

          away:
            row.away_team,

          actual:
            `${row.actual_home}-${row.actual_away}`,

          actual_result:
            row.actual_result,

          predicted:
            row.predicted_result,

          home_prob:
            `${(
              row.home_prob * 100
            ).toFixed(1)}%`,

          draw_prob:
            `${(
              row.draw_prob * 100
            ).toFixed(1)}%`,

          away_prob:
            `${(
              row.away_prob * 100
            ).toFixed(1)}%`,

          expected:
            `${row.predicted_home_goals.toFixed(2)}-${row.predicted_away_goals.toFixed(2)}`,

          history:
            row.history_matches,

          hit:
            row.result_hit
        }))
    );

    console.log(
      '\n=== LAST 10 WALK-FORWARD PREDICTIONS ===\n'
    );

    console.table(
      evaluated
        .slice(-10)
        .map(row => ({
          kickoff:
            row.kickoff,

          home:
            row.home_team,

          away:
            row.away_team,

          actual:
            `${row.actual_home}-${row.actual_away}`,

          actual_result:
            row.actual_result,

          predicted:
            row.predicted_result,

          home_prob:
            `${(
              row.home_prob * 100
            ).toFixed(1)}%`,

          draw_prob:
            `${(
              row.draw_prob * 100
            ).toFixed(1)}%`,

          away_prob:
            `${(
              row.away_prob * 100
            ).toFixed(1)}%`,

          expected:
            `${row.predicted_home_goals.toFixed(2)}-${row.predicted_away_goals.toFixed(2)}`,

          history:
            row.history_matches,

          hit:
            row.result_hit
        }))
    );
  }

  console.log(
    '\n=================================================='
  );

  console.log(
    'BACKTEST SELESAI'
  );

  console.log(
    'Database tidak diubah.'
  );

  console.log(
    '==================================================\n'
  );

} catch (error) {
  console.error(
    '\nBacktest gagal:',
    error.message
  );

  process.exitCode = 1;
} finally {
  db.close();
}
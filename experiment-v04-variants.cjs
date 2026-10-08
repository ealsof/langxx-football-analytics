const Database = require('better-sqlite3');

const db = new Database('./football.db', {
  readonly: true
});

// ============================================================
// CONFIG
// ============================================================

const HISTORY_THRESHOLD = 30;

const ELO_START = 1500;
const ELO_K = 25;

// ============================================================
// VARIANTS
// ============================================================
//
// homeAdvantage:
//   tambahan Elo untuk tim kandang
//
// goalDiffDivisor:
//   semakin besar -> pengaruh Elo ke expected goals semakin ringan
//
// awayGoalDiffDivisor:
//   semakin besar -> pengaruh Elo ke away goals semakin ringan
//

const VARIANTS = [
  {
    name: 'V04-baseline',
    homeAdvantage: 60,
    goalDiffDivisor: 1000,
    awayGoalDiffDivisor: 1200
  },

  {
    name: 'V04-home30',
    homeAdvantage: 30,
    goalDiffDivisor: 1000,
    awayGoalDiffDivisor: 1200
  },

  {
    name: 'V04-home0',
    homeAdvantage: 0,
    goalDiffDivisor: 1000,
    awayGoalDiffDivisor: 1200
  },

  {
    name: 'V04-light-elo',
    homeAdvantage: 60,
    goalDiffDivisor: 2000,
    awayGoalDiffDivisor: 2400
  },

  {
    name: 'V04-light-home30',
    homeAdvantage: 30,
    goalDiffDivisor: 2000,
    awayGoalDiffDivisor: 2400
  },

  {
    name: 'V04-light-home0',
    homeAdvantage: 0,
    goalDiffDivisor: 2000,
    awayGoalDiffDivisor: 2400
  }
];

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
        (ratingB - ratingA) / 400
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

    predictedResult
  };
}

// ============================================================
// V0.4 VARIANT
// ============================================================

function predictVariant(
  target,
  priorMatches,
  variant
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
      ratings.set(
        team,
        ELO_START
      );
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

  // ----------------------------------------------------------
  // BUILD ELO HISTORY
  // ----------------------------------------------------------

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
        homeRating +
          variant.homeAdvantage,
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
      ELO_K *
      multiplier;

    const newHomeRating =
      homeRating +
      k *
        (
          actualHome -
          expectedHome
        );

    const newAwayRating =
      awayRating +
      k *
        (
          (1 - actualHome) -
          (1 - expectedHome)
        );

    setRating(
      home,
      newHomeRating
    );

    setRating(
      away,
      newAwayRating
    );
  }

  // ----------------------------------------------------------
  // TARGET RATINGS
  // ----------------------------------------------------------

  const homeRating =
    getRating(
      target.home_team
    );

  const awayRating =
    getRating(
      target.away_team
    );

  const eloDifference =
    homeRating +
    variant.homeAdvantage -
    awayRating;

  // ----------------------------------------------------------
  // GOAL FACTORS
  // ----------------------------------------------------------

  const homeFactor =
    clip(
      1 +
        eloDifference /
          variant.goalDiffDivisor,
      0.65,
      1.35
    );

  const awayFactor =
    clip(
      1 -
        eloDifference /
          variant.awayGoalDiffDivisor,
      0.65,
      1.35
    );

  // ----------------------------------------------------------
  // LEAGUE AVERAGES
  // ----------------------------------------------------------

  let leagueHomeGoals = 0;
  let leagueAwayGoals = 0;

  for (const match of finished) {
    leagueHomeGoals +=
      Number(match.home_score);

    leagueAwayGoals +=
      Number(match.away_score);
  }

  const leagueHomeAverage =
    leagueHomeGoals /
    finished.length;

  const leagueAwayAverage =
    leagueAwayGoals /
    finished.length;

  // ----------------------------------------------------------
  // EXPECTED GOALS
  // ----------------------------------------------------------

  let predictedHomeGoals =
    leagueHomeAverage *
    homeFactor;

  let predictedAwayGoals =
    leagueAwayAverage *
    awayFactor;

  predictedHomeGoals =
    clip(
      predictedHomeGoals,
      0.2,
      4.5
    );

  predictedAwayGoals =
    clip(
      predictedAwayGoals,
      0.2,
      4.5
    );

  const prediction =
    poissonPrediction(
      predictedHomeGoals,
      predictedAwayGoals
    );

  return {
    ...prediction,

    homeRating,
    awayRating,

    eloDifference,

    homeFactor,
    awayFactor,

    leagueHomeAverage,
    leagueAwayAverage
  };
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
// EVALUATION
// ============================================================

function evaluate(
  prediction,
  target
) {
  const actual =
    result(
      Number(target.home_score),
      Number(target.away_score)
    );

  const resultHit =
    prediction.predictedResult ===
    actual
      ? 1
      : 0;

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

  const goalMAE =
    (
      Math.abs(
        prediction.predictedHomeGoals -
        Number(target.home_score)
      ) +

      Math.abs(
        prediction.predictedAwayGoals -
        Number(target.away_score)
      )
    ) / 2;

  const actualHome =
    actual === 'H' ? 1 : 0;

  const actualDraw =
    actual === 'D' ? 1 : 0;

  const actualAway =
    actual === 'A' ? 1 : 0;

  const brier =
    (
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
    ) / 3;

  return {
    actual,
    resultHit,
    exactScoreHit,
    goalMAE,
    brier
  };
}

// ============================================================
// RUN
// ============================================================

function runVariant(
  variant,
  matches
) {
  const rows = [];

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
      continue;
    }

    const prediction =
      predictVariant(
        target,
        priorMatches,
        variant
      );

    if (!prediction) {
      continue;
    }

    const evaluation =
      evaluate(
        prediction,
        target
      );

    rows.push({
      target,
      prediction,
      ...evaluation
    });
  }

  return rows;
}

// ============================================================
// METRICS
// ============================================================

function calculateMetrics(rows) {
  const n =
    rows.length;

  if (!n) {
    return null;
  }

  const accuracy =
    rows.reduce(
      (sum, row) =>
        sum + row.resultHit,
      0
    ) / n;

  const exactScore =
    rows.reduce(
      (sum, row) =>
        sum + row.exactScoreHit,
      0
    ) / n;

  const mae =
    rows.reduce(
      (sum, row) =>
        sum + row.goalMAE,
      0
    ) / n;

  const brier =
    rows.reduce(
      (sum, row) =>
        sum + row.brier,
      0
    ) / n;

  const distribution =
    rows.reduce(
      (acc, row) => {
        acc[row.prediction.predictedResult]++;
        return acc;
      },
      {
        H: 0,
        D: 0,
        A: 0
      }
    );

  const actualDistribution =
    rows.reduce(
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

  const avgHomeProb =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.homeProb,
      0
    ) / n;

  const avgDrawProb =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.drawProb,
      0
    ) / n;

  const avgAwayProb =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.awayProb,
      0
    ) / n;

  const avgHomeGoals =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.predictedHomeGoals,
      0
    ) / n;

  const avgAwayGoals =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.predictedAwayGoals,
      0
    ) / n;

  const avgEloDifference =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.eloDifference,
      0
    ) / n;

  return {
    n,
    accuracy,
    exactScore,
    mae,
    brier,

    avgHomeProb,
    avgDrawProb,
    avgAwayProb,

    avgHomeGoals,
    avgAwayGoals,

    avgEloDifference,

    distribution,
    actualDistribution
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
    'V0.4 VARIANT EXPERIMENT'
  );

  console.log(
    '==================================================\n'
  );

  const matches =
    getFinishedMatches();

  console.log(
    `Finished matches found : ${matches.length}`
  );

  console.log(
    `History threshold      : ${HISTORY_THRESHOLD}`
  );

  console.log(
    `Variants tested        : ${VARIANTS.length}`
  );

  const allResults = [];

  for (const variant of VARIANTS) {
    console.log(
      `\nTesting ${variant.name}...`
    );

    const rows =
      runVariant(
        variant,
        matches
      );

    const metrics =
      calculateMetrics(rows);

    allResults.push({
      variant,
      rows,
      metrics
    });
  }

  // ==========================================================
  // MAIN COMPARISON
  // ==========================================================

  console.log(
    '\n=== V0.4 VARIANT COMPARISON ===\n'
  );

  console.table(
    allResults.map(
      item => ({
        variant:
          item.variant.name,

        samples:
          item.metrics?.n ?? 0,

        accuracy:
          item.metrics
            ? `${(
                item.metrics.accuracy *
                100
              ).toFixed(2)}%`
            : 'N/A',

        exactScore:
          item.metrics
            ? `${(
                item.metrics.exactScore *
                100
              ).toFixed(2)}%`
            : 'N/A',

        mae:
          item.metrics
            ? item.metrics.mae.toFixed(4)
            : 'N/A',

        brier:
          item.metrics
            ? item.metrics.brier.toFixed(4)
            : 'N/A',

        predictedH:
          item.metrics?.distribution.H ?? 0,

        predictedD:
          item.metrics?.distribution.D ?? 0,

        predictedA:
          item.metrics?.distribution.A ?? 0,

        avgHomeProb:
          item.metrics
            ? `${(
                item.metrics.avgHomeProb *
                100
              ).toFixed(2)}%`
            : 'N/A',

        avgDrawProb:
          item.metrics
            ? `${(
                item.metrics.avgDrawProb *
                100
              ).toFixed(2)}%`
            : 'N/A',

        avgAwayProb:
          item.metrics
            ? `${(
                item.metrics.avgAwayProb *
                100
              ).toFixed(2)}%`
            : 'N/A'
      })
    )
  );

  // ==========================================================
  // CONFIGURATION TABLE
  // ==========================================================

  console.log(
    '\n=== VARIANT CONFIGURATION ===\n'
  );

  console.table(
    VARIANTS.map(
      variant => ({
        variant:
          variant.name,

        homeAdvantage:
          variant.homeAdvantage,

        goalDiffDivisor:
          variant.goalDiffDivisor,

        awayGoalDiffDivisor:
          variant.awayGoalDiffDivisor
      })
    )
  );

  // ==========================================================
  // DETAILS PER VARIANT
  // ==========================================================

  for (const item of allResults) {
    console.log(
      `\n=== ${item.variant.name} ===\n`
    );

    console.log(
      `Accuracy      : ${(
        item.metrics.accuracy *
        100
      ).toFixed(2)}%`
    );

    console.log(
      `Exact score   : ${(
        item.metrics.exactScore *
        100
      ).toFixed(2)}%`
    );

    console.log(
      `MAE           : ${item.metrics.mae.toFixed(4)}`
    );

    console.log(
      `Brier         : ${item.metrics.brier.toFixed(4)}`
    );

    console.log(
      `Avg H prob    : ${(
        item.metrics.avgHomeProb *
        100
      ).toFixed(2)}%`
    );

    console.log(
      `Avg D prob    : ${(
        item.metrics.avgDrawProb *
        100
      ).toFixed(2)}%`
    );

    console.log(
      `Avg A prob    : ${(
        item.metrics.avgAwayProb *
        100
      ).toFixed(2)}%`
    );

    console.log(
      `Avg H goals   : ${item.metrics.avgHomeGoals.toFixed(4)}`
    );

    console.log(
      `Avg A goals   : ${item.metrics.avgAwayGoals.toFixed(4)}`
    );

    console.log(
      `Avg Elo diff  : ${item.metrics.avgEloDifference.toFixed(2)}`
    );

    console.log(
      'Prediction distribution:'
    );

    console.table(
      item.metrics.distribution
    );
  }

  // ==========================================================
  // BEST BY EACH METRIC
  // ==========================================================

  const bestAccuracy =
    [...allResults]
      .sort(
        (a, b) =>
          b.metrics.accuracy -
          a.metrics.accuracy
      )[0];

  const bestMAE =
    [...allResults]
      .sort(
        (a, b) =>
          a.metrics.mae -
          b.metrics.mae
      )[0];

  const bestBrier =
    [...allResults]
      .sort(
        (a, b) =>
          a.metrics.brier -
          b.metrics.brier
      )[0];

  const bestExactScore =
    [...allResults]
      .sort(
        (a, b) =>
          b.metrics.exactScore -
          a.metrics.exactScore
      )[0];

  console.log(
    '\n=== BEST VARIANTS ===\n'
  );

  console.log(
    `Best Accuracy   : ${bestAccuracy.variant.name} (${(
      bestAccuracy.metrics.accuracy *
      100
    ).toFixed(2)}%)`
  );

  console.log(
    `Best Exact Score: ${bestExactScore.variant.name} (${(
      bestExactScore.metrics.exactScore *
      100
    ).toFixed(2)}%)`
  );

  console.log(
    `Best MAE        : ${bestMAE.variant.name} (${bestMAE.metrics.mae.toFixed(4)})`
  );

  console.log(
    `Best Brier      : ${bestBrier.variant.name} (${bestBrier.metrics.brier.toFixed(4)})`
  );

  // ==========================================================
  // SAMPLE OUTPUT
  // ==========================================================

  console.log(
    '\n=== SAMPLE: FIRST 5 TARGETS PER VARIANT ===\n'
  );

  for (const item of allResults) {
    console.log(
      `\n--- ${item.variant.name} ---`
    );

    console.table(
      item.rows
        .slice(0, 5)
        .map(
          (row, index) => ({
            no:
              index + 1,

            match:
              `${row.target.home_team} vs ${row.target.away_team}`,

            actual:
              `${row.target.home_score}-${row.target.away_score}`,

            actualResult:
              row.actual,

            homeProb:
              `${(
                row.prediction.homeProb *
                100
              ).toFixed(1)}%`,

            drawProb:
              `${(
                row.prediction.drawProb *
                100
              ).toFixed(1)}%`,

            awayProb:
              `${(
                row.prediction.awayProb *
                100
              ).toFixed(1)}%`,

            predicted:
              row.prediction.predictedResult,

            expectedGoals:
              `${row.prediction.predictedHomeGoals.toFixed(2)}-${row.prediction.predictedAwayGoals.toFixed(2)}`
          })
        )
    );
  }

  console.log(
    '\n=================================================='
  );

  console.log(
    'V0.4 VARIANT EXPERIMENT SELESAI'
  );

  console.log(
    'Database tidak diubah.'
  );

  console.log(
    '==================================================\n'
  );

} catch (error) {
  console.error(
    '\nEksperimen gagal:',
    error.message
  );

  process.exitCode = 1;

} finally {
  db.close();
}
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
//   bonus Elo untuk tim kandang.
//
// eloScale:
//   semakin kecil -> pengaruh perbedaan Elo semakin kuat.
//
// total expected goals TIDAK berubah karena Elo.
// Elo hanya menentukan pembagian T antara home dan away.
//
// Contoh:
// total = 2.70
// share home = 46%
// share away = 54%
//
// => home xG = 1.242
// => away xG = 1.458
//

const VARIANTS = [
  {
    name: 'V04R-HA60-S400',
    homeAdvantage: 60,
    eloScale: 400
  },

  {
    name: 'V04R-HA30-S400',
    homeAdvantage: 30,
    eloScale: 400
  },

  {
    name: 'V04R-HA0-S400',
    homeAdvantage: 0,
    eloScale: 400
  },

  {
    name: 'V04R-HA60-S600',
    homeAdvantage: 60,
    eloScale: 600
  },

  {
    name: 'V04R-HA30-S600',
    homeAdvantage: 30,
    eloScale: 600
  },

  {
    name: 'V04R-HA0-S600',
    homeAdvantage: 0,
    eloScale: 600
  },

  {
    name: 'V04R-HA60-S800',
    homeAdvantage: 60,
    eloScale: 800
  },

  {
    name: 'V04R-HA30-S800',
    homeAdvantage: 30,
    eloScale: 800
  },

  {
    name: 'V04R-HA0-S800',
    homeAdvantage: 0,
    eloScale: 800
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

  let predictedResult;

  if (
    probabilities.home >= probabilities.draw &&
    probabilities.home >= probabilities.away
  ) {
    predictedResult = 'H';
  } else if (
    probabilities.draw >= probabilities.away
  ) {
    predictedResult = 'D';
  } else {
    predictedResult = 'A';
  }

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
// ELO SHARE
// ============================================================
//
// Mengubah selisih Elo menjadi home-goal share.
//
// Logistic:
//   share = 1 / (1 + 10^(-difference / scale))
//
// Tetapi kita tidak mau share terlalu ekstrem.
// Maka kita batasi 30% - 70%.
//

function calculateHomeShare(
  eloDifference,
  eloScale
) {
  const rawShare =
    1 /
    (
      1 +
      Math.pow(
        10,
        -eloDifference / eloScale
      )
    );

  return clip(
    rawShare,
    0.30,
    0.70
  );
}

// ============================================================
// V0.4 REBALANCED
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

  // ----------------------------------------------------------
  // ELO
  // ----------------------------------------------------------

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
  // BUILD HISTORICAL ELO
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
  // TARGET ELO
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
  // COMPETITION TOTAL EXPECTED GOALS
  // ----------------------------------------------------------

  let totalGoals = 0;

  for (const match of finished) {
    totalGoals +=
      Number(match.home_score) +
      Number(match.away_score);
  }

  const averageTotalGoals =
    totalGoals /
    finished.length;

  // ----------------------------------------------------------
  // ELO -> GOAL SHARE
  // ----------------------------------------------------------

  const homeShare =
    calculateHomeShare(
      eloDifference,
      variant.eloScale
    );

  const awayShare =
    1 - homeShare;

  // ----------------------------------------------------------
  // EXPECTED GOALS
  // ----------------------------------------------------------

  let predictedHomeGoals =
    averageTotalGoals *
    homeShare;

  let predictedAwayGoals =
    averageTotalGoals *
    awayShare;

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

    homeShare,
    awayShare,

    averageTotalGoals
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
// RUN VARIANT
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

  const avgHomeShare =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.homeShare,
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

    avgHomeShare,
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
    'V0.4-REBALANCED EXPERIMENT'
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

  console.log(
    '\nActual distribution of 59 evaluated targets will be shown below.'
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
    '\n=== V0.4-REBALANCED COMPARISON ===\n'
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
            : 'N/A',

        avgHomeShare:
          item.metrics
            ? `${(
                item.metrics.avgHomeShare *
                100
              ).toFixed(2)}%`
            : 'N/A'
      })
    )
  );

  // ==========================================================
  // ACTUAL DISTRIBUTION
  // ==========================================================

  const actual =
    allResults[0].metrics
      .actualDistribution;

  console.log(
    '\n=== ACTUAL DISTRIBUTION ===\n'
  );

  console.table({
    Home: actual.H,
    Draw: actual.D,
    Away: actual.A
  });

  console.log(
    `Actual H: ${(
      actual.H /
      allResults[0].metrics.n *
      100
    ).toFixed(2)}%`
  );

  console.log(
    `Actual D: ${(
      actual.D /
      allResults[0].metrics.n *
      100
    ).toFixed(2)}%`
  );

  console.log(
    `Actual A: ${(
      actual.A /
      allResults[0].metrics.n *
      100
    ).toFixed(2)}%`
  );

  // ==========================================================
  // VARIANT CONFIGURATION
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

        eloScale:
          variant.eloScale
      })
    )
  );

  // ==========================================================
  // BEST VARIANTS
  // ==========================================================

  const bestAccuracy =
    [...allResults]
      .sort(
        (a, b) =>
          b.metrics.accuracy -
          a.metrics.accuracy
      )[0];

  const bestExactScore =
    [...allResults]
      .sort(
        (a, b) =>
          b.metrics.exactScore -
          a.metrics.exactScore
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
  // FIRST 10 TARGETS
  // ==========================================================

  console.log(
    '\n=== FIRST 10 TARGETS PER VARIANT ===\n'
  );

  for (const item of allResults) {
    console.log(
      `\n--- ${item.variant.name} ---`
    );

    console.table(
      item.rows
        .slice(0, 10)
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

            eloDiff:
              row.prediction.eloDifference.toFixed(1),

            homeShare:
              `${(
                row.prediction.homeShare *
                100
              ).toFixed(1)}%`,

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

  // ==========================================================
  // DISTRIBUTION DISTANCE
  // ==========================================================
  //
  // Mengukur seberapa jauh distribusi prediksi dari distribusi
  // aktual. Semakin kecil semakin dekat.
  //

  console.log(
    '\n=== DISTRIBUTION DISTANCE ===\n'
  );

  const actualTotal =
    actual.H +
    actual.D +
    actual.A;

  console.table(
    allResults.map(
      item => {
        const predicted =
          item.metrics.distribution;

        const homeDistance =
          Math.abs(
            predicted.H /
              item.metrics.n -
              actual.H /
              actualTotal
          );

        const drawDistance =
          Math.abs(
            predicted.D /
              item.metrics.n -
              actual.D /
              actualTotal
          );

        const awayDistance =
          Math.abs(
            predicted.A /
              item.metrics.n -
              actual.A /
              actualTotal
          );

        const totalDistance =
          homeDistance +
          drawDistance +
          awayDistance;

        return {
          variant:
            item.variant.name,

          predictedH:
            predicted.H,

          predictedD:
            predicted.D,

          predictedA:
            predicted.A,

          distance:
            totalDistance.toFixed(4)
        };
      }
    )
  );

  // ==========================================================
  // END
  // ==========================================================

  console.log(
    '\n=================================================='
  );

  console.log(
    'V0.4-REBALANCED EXPERIMENT SELESAI'
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
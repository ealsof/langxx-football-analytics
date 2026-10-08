// ============================================================
// FOOTBALL ANALYTICS LAB
// V0.4 DRAW EXPERIMENT
// READ-ONLY EXPERIMENT
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------

const DB_PATH = path.join(
  __dirname,
  'football.db'
);

const HISTORY_THRESHOLD = 30;

// V0.4 Rebalanced baseline
const HOME_ADVANTAGE = 0;
const ELO_SCALE = 400;

const ELO_START = 1500;
const ELO_K = 25;

// ------------------------------------------------------------
// DRAW EXPERIMENT VARIANTS
// ------------------------------------------------------------

const VARIANTS = [
  {
    name: 'D0-BASELINE',
    totalBoost: 0,
    balanceBoost: 0
  },

  {
    name: 'D1-TOTAL-LIGHT',
    totalBoost: 0.08,
    balanceBoost: 0
  },

  {
    name: 'D2-TOTAL-MEDIUM',
    totalBoost: 0.15,
    balanceBoost: 0
  },

  {
    name: 'D3-BALANCE-LIGHT',
    totalBoost: 0,
    balanceBoost: 0.08
  },

  {
    name: 'D4-BALANCE-MEDIUM',
    totalBoost: 0,
    balanceBoost: 0.15
  },

  {
    name: 'D5-COMBINED-LIGHT',
    totalBoost: 0.08,
    balanceBoost: 0.08
  },

  {
    name: 'D6-COMBINED-MEDIUM',
    totalBoost: 0.15,
    balanceBoost: 0.15
  },

  {
    name: 'D7-COMBINED-STRONG',
    totalBoost: 0.20,
    balanceBoost: 0.20
  },

  {
    name: 'D8-TOTAL-STRONG-BALANCE-LIGHT',
    totalBoost: 0.25,
    balanceBoost: 0.08
  }
];

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poissonProbability(lambda, k) {
  if (lambda <= 0) {
    return k === 0 ? 1 : 0;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial(k)
  );
}

function clip(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
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

function actualResult(
  homeGoals,
  awayGoals
) {
  if (homeGoals > awayGoals) {
    return 'H';
  }

  if (homeGoals < awayGoals) {
    return 'A';
  }

  return 'D';
}

function predictedResult(
  probabilities
) {
  if (
    probabilities.home >=
      probabilities.draw &&
    probabilities.home >=
      probabilities.away
  ) {
    return 'H';
  }

  if (
    probabilities.away >=
      probabilities.home &&
    probabilities.away >=
      probabilities.draw
  ) {
    return 'A';
  }

  return 'D';
}

// ------------------------------------------------------------
// POISSON MODEL
// ------------------------------------------------------------

function poissonPrediction(
  homeExpected,
  awayExpected
) {
  const maxGoals = 10;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  const matrix = [];

  for (
    let homeGoals = 0;
    homeGoals <= maxGoals;
    homeGoals++
  ) {
    const row = [];

    const pHome =
      poissonProbability(
        homeExpected,
        homeGoals
      );

    for (
      let awayGoals = 0;
      awayGoals <= maxGoals;
      awayGoals++
    ) {
      const pAway =
        poissonProbability(
          awayExpected,
          awayGoals
        );

      const probability =
        pHome * pAway;

      row.push(probability);

      if (
        homeGoals >
        awayGoals
      ) {
        homeWin += probability;
      } else if (
        homeGoals ===
        awayGoals
      ) {
        draw += probability;
      } else {
        awayWin += probability;
      }
    }

    matrix.push(row);
  }

  const probabilities =
    normalizeProbabilities(
      homeWin,
      draw,
      awayWin
    );

  let bestProbability = -1;
  let bestHomeGoals = 0;
  let bestAwayGoals = 0;

  for (
    let homeGoals = 0;
    homeGoals <= maxGoals;
    homeGoals++
  ) {
    for (
      let awayGoals = 0;
      awayGoals <= maxGoals;
      awayGoals++
    ) {
      const probability =
        matrix[homeGoals][awayGoals];

      if (
        probability >
        bestProbability
      ) {
        bestProbability =
          probability;

        bestHomeGoals =
          homeGoals;

        bestAwayGoals =
          awayGoals;
      }
    }
  }

  return {
    ...probabilities,

    expectedHomeGoals:
      homeExpected,

    expectedAwayGoals:
      awayExpected,

    predictedHomeGoals:
      bestHomeGoals,

    predictedAwayGoals:
      bestAwayGoals,

    poissonDrawProbability:
      probabilities.draw
  };
}

// ------------------------------------------------------------
// ELO
// ------------------------------------------------------------

function getMarginMultiplier(
  goalDifference
) {
  if (goalDifference <= 1) {
    return 1;
  }

  if (goalDifference === 2) {
    return 1.25;
  }

  return 1.5;
}

function calculateEloRatings(
  priorMatches
) {
  const ratings = new Map();

  function getRating(teamId) {
    if (!ratings.has(teamId)) {
      ratings.set(
        teamId,
        ELO_START
      );
    }

    return ratings.get(teamId);
  }

  function setRating(
    teamId,
    rating
  ) {
    ratings.set(
      teamId,
      rating
    );
  }

  for (
    const match of priorMatches
  ) {
    const homeId =
      match.home_team_id;

    const awayId =
      match.away_team_id;

    const homeRating =
      getRating(homeId);

    const awayRating =
      getRating(awayId);

    const expectedHome =
      1 /
      (
        1 +
        Math.pow(
          10,
          (
            awayRating -
            (
              homeRating +
              HOME_ADVANTAGE
            )
          ) / 400
        )
      );

    const homeGoals =
      Number(
        match.home_score
      );

    const awayGoals =
      Number(
        match.away_score
      );

    const goalDifference =
      Math.abs(
        homeGoals -
        awayGoals
      );

    const marginMultiplier =
      getMarginMultiplier(
        goalDifference
      );

    let actualHome = 0.5;

    if (
      homeGoals >
      awayGoals
    ) {
      actualHome = 1;
    } else if (
      homeGoals <
      awayGoals
    ) {
      actualHome = 0;
    }

    const ratingChange =
      ELO_K *
      marginMultiplier *
      (
        actualHome -
        expectedHome
      );

    setRating(
      homeId,
      homeRating +
      ratingChange
    );

    setRating(
      awayId,
      awayRating -
      ratingChange
    );
  }

  return ratings;
}

// ------------------------------------------------------------
// V0.4 REBALANCED
// ------------------------------------------------------------

function predictV04Rebalanced(
  target,
  priorMatches
) {
  if (
    priorMatches.length <
    HISTORY_THRESHOLD
  ) {
    return null;
  }

  const ratings =
    calculateEloRatings(
      priorMatches
    );

  const homeRating =
    ratings.get(
      target.home_team_id
    ) ??
    ELO_START;

  const awayRating =
    ratings.get(
      target.away_team_id
    ) ??
    ELO_START;

  const eloDifference =
    homeRating +
    HOME_ADVANTAGE -
    awayRating;

  const homeShare =
    clip(
      1 +
      eloDifference /
      ELO_SCALE,
      0.65,
      1.35
    );

  const awayShare =
    clip(
      1 -
      eloDifference /
      ELO_SCALE,
      0.65,
      1.35
    );

  const totalPriorGoals =
    priorMatches.reduce(
      (
        total,
        match
      ) =>
        total +
        Number(
          match.home_score
        ) +
        Number(
          match.away_score
        ),
      0
    );

  const leagueAverageGoals =
    priorMatches.length > 0
      ? totalPriorGoals /
        priorMatches.length
      : 2.5;

  let homeExpected =
    leagueAverageGoals *
    homeShare /
    (
      homeShare +
      awayShare
    );

  let awayExpected =
    leagueAverageGoals *
    awayShare /
    (
      homeShare +
      awayShare
    );

  homeExpected =
    clip(
      homeExpected,
      0.2,
      4.5
    );

  awayExpected =
    clip(
      awayExpected,
      0.2,
      4.5
    );

  const prediction =
    poissonPrediction(
      homeExpected,
      awayExpected
    );

  return {
    ...prediction,

    eloDifference,

    homeShareRaw:
      homeShare,

    awayShareRaw:
      awayShare,

    homeRating,

    awayRating
  };
}

// ------------------------------------------------------------
// DRAW ADJUSTMENT
// ------------------------------------------------------------

function applyDrawAdjustment(
  prediction,
  variant
) {
  const homeExpected =
    prediction.expectedHomeGoals;

  const awayExpected =
    prediction.expectedAwayGoals;

  const totalExpected =
    homeExpected +
    awayExpected;

  const expectedDifference =
    Math.abs(
      homeExpected -
      awayExpected
    );

  // Lower expected total goals
  // -> more draw-friendly.
  const lowGoalFactor =
    clip(
      (
        3.2 -
        totalExpected
      ) /
      (
        3.2 -
        1.8
      ),
      0,
      1
    );

  // Smaller expected-goal difference
  // -> more balanced.
  const balanceFactor =
    clip(
      (
        0.90 -
        expectedDifference
      ) /
      (
        0.90 -
        0.15
      ),
      0,
      1
    );

  const totalBoost =
    variant.totalBoost *
    lowGoalFactor;

  const balanceBoost =
    variant.balanceBoost *
    balanceFactor;

  const drawBoost =
    totalBoost +
    balanceBoost;

  const adjustedDraw =
    prediction.draw *
    (
      1 +
      drawBoost
    );

  const probabilities =
    normalizeProbabilities(
      prediction.home,
      adjustedDraw,
      prediction.away
    );

  return {
    ...prediction,

    home:
      probabilities.home,

    draw:
      probabilities.draw,

    away:
      probabilities.away,

    drawBoost,

    lowGoalFactor,

    balanceFactor,

    predictedResult:
      predictedResult(
        probabilities
      )
  };
}

// ------------------------------------------------------------
// DATABASE
// ------------------------------------------------------------

const db =
  new Database(
    DB_PATH,
    {
      readonly: true
    }
  );

// ------------------------------------------------------------
// LOAD FINISHED MATCHES
// ------------------------------------------------------------

const matches =
  db.prepare(`
    SELECT
      id,
      competition,
      kickoff,
      status,
      home_team_id,
      away_team_id,
      home_score,
      away_score
    FROM matches
    WHERE
      status = 'finished'
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
    ORDER BY kickoff ASC
  `).all();

console.log('');
console.log(
  '=================================================='
);
console.log(
  'FOOTBALL ANALYTICS LAB'
);
console.log(
  'V0.4 DRAW EXPERIMENT'
);
console.log(
  '=================================================='
);
console.log('');

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
  `Home Advantage         : ${HOME_ADVANTAGE}`
);

console.log(
  `Elo Scale              : ${ELO_SCALE}`
);

console.log('');

// ------------------------------------------------------------
// PRIOR MATCHES
// ------------------------------------------------------------

function getPriorMatches(
  target
) {
  return matches.filter(
    match =>
      match.competition ===
        target.competition &&
      match.kickoff <
        target.kickoff
  );
}

// ------------------------------------------------------------
// RUN VARIANT
// ------------------------------------------------------------

function runVariant(
  variant
) {
  const rows = [];

  for (
    const target of matches
  ) {
    const priorMatches =
      getPriorMatches(
        target
      );

    if (
      priorMatches.length <
      HISTORY_THRESHOLD
    ) {
      continue;
    }

    const basePrediction =
      predictV04Rebalanced(
        target,
        priorMatches
      );

    if (!basePrediction) {
      continue;
    }

    const prediction =
      applyDrawAdjustment(
        basePrediction,
        variant
      );

    const actual =
      actualResult(
        Number(
          target.home_score
        ),
        Number(
          target.away_score
        )
      );

    rows.push({
      target,
      prediction,
      actual
    });
  }

  return rows;
}

// ------------------------------------------------------------
// METRICS
// ------------------------------------------------------------

function calculateMetrics(
  rows
) {
  let correct = 0;
  let exactScore = 0;

  let totalMae = 0;
  let totalBrier = 0;

  let predictedH = 0;
  let predictedD = 0;
  let predictedA = 0;

  let actualH = 0;
  let actualD = 0;
  let actualA = 0;

  let totalHomeProb = 0;
  let totalDrawProb = 0;
  let totalAwayProb = 0;

  let totalDrawBoost = 0;

  for (
    const row of rows
  ) {
    const {
      target,
      prediction,
      actual
    } = row;

    if (
      prediction.predictedResult ===
      actual
    ) {
      correct++;
    }

    if (
      prediction.predictedHomeGoals ===
        Number(
          target.home_score
        ) &&
      prediction.predictedAwayGoals ===
        Number(
          target.away_score
        )
    ) {
      exactScore++;
    }

    totalMae +=
      Math.abs(
        prediction.expectedHomeGoals -
        Number(
          target.home_score
        )
      );

    totalMae +=
      Math.abs(
        prediction.expectedAwayGoals -
        Number(
          target.away_score
        )
      );

    let actualVector;

    if (actual === 'H') {
      actualVector = [1, 0, 0];
      actualH++;
    } else if (actual === 'D') {
      actualVector = [0, 1, 0];
      actualD++;
    } else {
      actualVector = [0, 0, 1];
      actualA++;
    }

    const predictedVector = [
      prediction.home,
      prediction.draw,
      prediction.away
    ];

    const brier =
      (
        Math.pow(
          predictedVector[0] -
          actualVector[0],
          2
        ) +
        Math.pow(
          predictedVector[1] -
          actualVector[1],
          2
        ) +
        Math.pow(
          predictedVector[2] -
          actualVector[2],
          2
        )
      ) / 3;

    totalBrier +=
      brier;

    if (
      prediction.predictedResult ===
      'H'
    ) {
      predictedH++;
    } else if (
      prediction.predictedResult ===
      'D'
    ) {
      predictedD++;
    } else {
      predictedA++;
    }

    totalHomeProb +=
      prediction.home;

    totalDrawProb +=
      prediction.draw;

    totalAwayProb +=
      prediction.away;

    totalDrawBoost +=
      prediction.drawBoost;
  }

  const n =
    rows.length;

  if (n === 0) {
    return {
      samples: 0
    };
  }

  const actualShares = {
    H: actualH / n,
    D: actualD / n,
    A: actualA / n
  };

  const predictedShares = {
    H: predictedH / n,
    D: predictedD / n,
    A: predictedA / n
  };

  const distributionDistance =
    Math.abs(
      predictedShares.H -
      actualShares.H
    ) +
    Math.abs(
      predictedShares.D -
      actualShares.D
    ) +
    Math.abs(
      predictedShares.A -
      actualShares.A
    );

  return {
    samples: n,

    accuracy:
      correct / n,

    exactScore:
      exactScore / n,

    mae:
      totalMae /
      (n * 2),

    brier:
      totalBrier / n,

    predictedH,
    predictedD,
    predictedA,

    actualH,
    actualD,
    actualA,

    avgHomeProb:
      totalHomeProb / n,

    avgDrawProb:
      totalDrawProb / n,

    avgAwayProb:
      totalAwayProb / n,

    avgDrawBoost:
      totalDrawBoost / n,

    distributionDistance
  };
}

// ------------------------------------------------------------
// RUN
// ------------------------------------------------------------

const allResults = [];

for (
  const variant of VARIANTS
) {
  const rows =
    runVariant(
      variant
    );

  const metrics =
    calculateMetrics(
      rows
    );

  allResults.push({
    variant:
      variant.name,

    ...metrics
  });
}

// ------------------------------------------------------------
// RESULTS
// ------------------------------------------------------------

console.log('');
console.log(
  '=== V0.4 DRAW EXPERIMENT COMPARISON ==='
);

console.table(
  allResults.map(
    result => ({
      variant:
        result.variant,

      samples:
        result.samples,

      accuracy:
        `${(
          result.accuracy *
          100
        ).toFixed(2)}%`,

      exactScore:
        `${(
          result.exactScore *
          100
        ).toFixed(2)}%`,

      mae:
        result.mae.toFixed(4),

      brier:
        result.brier.toFixed(4),

      predictedH:
        result.predictedH,

      predictedD:
        result.predictedD,

      predictedA:
        result.predictedA,

      avgDrawProb:
        `${(
          result.avgDrawProb *
          100
        ).toFixed(2)}%`,

      avgDrawBoost:
        result.avgDrawBoost
          .toFixed(4),

      distributionDistance:
        result.distributionDistance
          .toFixed(4)
    })
  )
);

// ------------------------------------------------------------
// ACTUAL DISTRIBUTION
// ------------------------------------------------------------

const baselineRows =
  runVariant(
    VARIANTS[0]
  );

const baselineMetrics =
  calculateMetrics(
    baselineRows
  );

console.log('');
console.log(
  '=== ACTUAL DISTRIBUTION ==='
);

console.log(
  `Home : ${baselineMetrics.actualH} (${(
    baselineMetrics.actualH /
    baselineMetrics.samples *
    100
  ).toFixed(2)}%)`
);

console.log(
  `Draw : ${baselineMetrics.actualD} (${(
    baselineMetrics.actualD /
    baselineMetrics.samples *
    100
  ).toFixed(2)}%)`
);

console.log(
  `Away : ${baselineMetrics.actualA} (${(
    baselineMetrics.actualA /
    baselineMetrics.samples *
    100
  ).toFixed(2)}%)`
);

// ------------------------------------------------------------
// BEST VARIANTS
// ------------------------------------------------------------

function bestBy(
  field,
  lowerIsBetter = false
) {
  return [
    ...allResults
  ].sort(
    (a, b) =>
      lowerIsBetter
        ? a[field] -
          b[field]
        : b[field] -
          a[field]
  )[0];
}

const bestAccuracy =
  bestBy(
    'accuracy'
  );

const bestExact =
  bestBy(
    'exactScore'
  );

const bestMae =
  bestBy(
    'mae',
    true
  );

const bestBrier =
  bestBy(
    'brier',
    true
  );

const bestDistribution =
  bestBy(
    'distributionDistance',
    true
  );

console.log('');
console.log(
  '=== BEST VARIANTS ==='
);

console.log(
  `Best Accuracy    : ${bestAccuracy.variant} (${(
    bestAccuracy.accuracy *
    100
  ).toFixed(2)}%)`
);

console.log(
  `Best Exact Score : ${bestExact.variant} (${(
    bestExact.exactScore *
    100
  ).toFixed(2)}%)`
);

console.log(
  `Best MAE         : ${bestMae.variant} (${bestMae.mae.toFixed(4)})`
);

console.log(
  `Best Brier       : ${bestBrier.variant} (${bestBrier.brier.toFixed(4)})`
);

console.log(
  `Best Distribution: ${bestDistribution.variant} (distance ${bestDistribution.distributionDistance.toFixed(4)})`
);

// ------------------------------------------------------------
// DRAW AUDIT
// ------------------------------------------------------------

const bestVariantConfig =
  VARIANTS.find(
    variant =>
      variant.name ===
      bestDistribution.variant
  );

const bestRows =
  runVariant(
    bestVariantConfig
  );

const drawPredictions =
  bestRows.filter(
    row =>
      row.prediction.predictedResult ===
      'D'
  );

console.log('');
console.log(
  `=== DRAW AUDIT: ${bestDistribution.variant} ===`
);

console.log(
  `Predicted Draw : ${drawPredictions.length}`
);

console.log(
  `Actual Draw    : ${bestRows.filter(row => row.actual === 'D').length}`
);

if (
  drawPredictions.length > 0
) {
  console.table(
    drawPredictions.map(
      row => ({
        match:
          `${row.target.home_team_id} vs ${row.target.away_team_id}`,

        actual:
          `${row.target.home_score}-${row.target.away_score}`,

        homeProb:
          `${(
            row.prediction.home *
            100
          ).toFixed(2)}%`,

        drawProb:
          `${(
            row.prediction.draw *
            100
          ).toFixed(2)}%`,

        awayProb:
          `${(
            row.prediction.away *
            100
          ).toFixed(2)}%`,

        expectedGoals:
          `${row.prediction.expectedHomeGoals.toFixed(2)}-${row.prediction.expectedAwayGoals.toFixed(2)}`,

        drawBoost:
          row.prediction.drawBoost
            .toFixed(4)
      })
    )
  );
}

// ------------------------------------------------------------
// FIRST 10
// ------------------------------------------------------------

console.log('');
console.log(
  `=== FIRST 10 TARGETS: ${bestDistribution.variant} ===`
);

console.table(
  bestRows
    .slice(0, 10)
    .map(
      (
        row,
        index
      ) => ({
        no:
          index + 1,

        match:
          `${row.target.home_team_id} vs ${row.target.away_team_id}`,

        actual:
          `${row.target.home_score}-${row.target.away_score}`,

        actualResult:
          row.actual,

        homeProb:
          `${(
            row.prediction.home *
            100
          ).toFixed(1)}%`,

        drawProb:
          `${(
            row.prediction.draw *
            100
          ).toFixed(1)}%`,

        awayProb:
          `${(
            row.prediction.away *
            100
          ).toFixed(1)}%`,

        predicted:
          row.prediction.predictedResult,

        expectedGoals:
          `${row.prediction.expectedHomeGoals.toFixed(2)}-${row.prediction.expectedAwayGoals.toFixed(2)}`,

        drawBoost:
          row.prediction.drawBoost
            .toFixed(4)
      })
    )
);

// ------------------------------------------------------------
// CLOSE
// ------------------------------------------------------------

db.close();

console.log('');
console.log(
  '=================================================='
);

console.log(
  'V0.4 DRAW EXPERIMENT SELESAI'
);

console.log(
  'DATABASE TIDAK DIUBAH'
);

console.log(
  'PRODUCTION TIDAK DIUBAH'
);

console.log(
  '=================================================='
);
// ============================================================
// FOOTBALL ANALYTICS LAB
// ENSEMBLE WEIGHT SWEEP
// READ-ONLY EXPERIMENT
// ============================================================
//
// Menguji kombinasi bobot V0.2 + V0.4 pada walk-forward
// backtest yang sama.
//
// PENTING:
// - Menggunakan formula V0.2 production.
// - Menggunakan formula V0.4 production ASLI.
// - Tidak menggunakan V0.4 rebalanced experiment.
// - Database hanya dibaca.
// - Tidak membuat / mengubah prediction production.
//
// Bobot yang diuji:
//
// V0.2 / V0.4
// 100 / 0
// 90  / 10
// 80  / 20
// 70  / 30
// 60  / 40
// 50  / 50
// 40  / 60
// 30  / 70
// 20  / 80
// 10  / 90
// 0   / 100
//
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

// V0.2
const V02_HOME_GOAL_BONUS = 1.05;

// V0.4 production ASLI
const V04_HOME_ADVANTAGE = 60;
const V04_K = 25;
const V04_ELO_START = 1500;

// ------------------------------------------------------------
// WEIGHT VARIANTS
// ------------------------------------------------------------

const WEIGHT_VARIANTS = [
  { v02: 1.00, v04: 0.00 },
  { v02: 0.90, v04: 0.10 },
  { v02: 0.80, v04: 0.20 },
  { v02: 0.70, v04: 0.30 },
  { v02: 0.60, v04: 0.40 },
  { v02: 0.50, v04: 0.50 },
  { v02: 0.40, v04: 0.60 },
  { v02: 0.30, v04: 0.70 },
  { v02: 0.20, v04: 0.80 },
  { v02: 0.10, v04: 0.90 },
  { v02: 0.00, v04: 1.00 }
];

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function factorial(n) {
  if (n <= 1) {
    return 1;
  }

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poissonProbability(
  lambda,
  goals
) {
  if (lambda <= 0) {
    return goals === 0 ? 1 : 0;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals) /
    factorial(goals)
  );
}

function clip(
  value,
  min,
  max
) {
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

// ------------------------------------------------------------
// V0.2 PRODUCTION
// ------------------------------------------------------------

function predictV02(
  target,
  priorMatches
) {
  if (
    priorMatches.length <
    HISTORY_THRESHOLD
  ) {
    return null;
  }

  let leagueHomeGoals = 0;
  let leagueAwayGoals = 0;

  let homeGoalsFor = 0;
  let homeGoalsAgainst = 0;

  let awayGoalsFor = 0;
  let awayGoalsAgainst = 0;

  let homeMatches = 0;
  let awayMatches = 0;

  for (
    const match of priorMatches
  ) {
    const homeScore =
      Number(match.home_score);

    const awayScore =
      Number(match.away_score);

    leagueHomeGoals +=
      homeScore;

    leagueAwayGoals +=
      awayScore;

    if (
      match.home_team_id ===
      target.home_team_id
    ) {
      homeMatches++;

      homeGoalsFor +=
        homeScore;

      homeGoalsAgainst +=
        awayScore;
    }

    if (
      match.away_team_id ===
      target.home_team_id
    ) {
      homeMatches++;

      homeGoalsFor +=
        awayScore;

      homeGoalsAgainst +=
        homeScore;
    }

    if (
      match.home_team_id ===
      target.away_team_id
    ) {
      awayMatches++;

      awayGoalsFor +=
        homeScore;

      awayGoalsAgainst +=
        awayScore;
    }

    if (
      match.away_team_id ===
      target.away_team_id
    ) {
      awayMatches++;

      awayGoalsFor +=
        awayScore;

      awayGoalsAgainst +=
        homeScore;
    }
  }

  if (
    homeMatches <= 0 ||
    awayMatches <= 0
  ) {
    return null;
  }

  const leagueHomeAverage =
    leagueHomeGoals /
    priorMatches.length;

  const leagueAwayAverage =
    leagueAwayGoals /
    priorMatches.length;

  if (
    leagueHomeAverage <= 0 ||
    leagueAwayAverage <= 0
  ) {
    return null;
  }

  const homeAttack =
    (
      homeGoalsFor /
      homeMatches
    ) /
    leagueHomeAverage;

  const homeDefense =
    (
      homeGoalsAgainst /
      homeMatches
    ) /
    leagueAwayAverage;

  const awayAttack =
    (
      awayGoalsFor /
      awayMatches
    ) /
    leagueAwayAverage;

  const awayDefense =
    (
      awayGoalsAgainst /
      awayMatches
    ) /
    leagueHomeAverage;

  let homeExpected =
    leagueHomeAverage *
    homeAttack *
    awayDefense;

  let awayExpected =
    leagueAwayAverage *
    awayAttack *
    homeDefense;

  homeExpected *=
    V02_HOME_GOAL_BONUS;

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

  const matrix = [];

  for (
    let homeGoals = 0;
    homeGoals <= 10;
    homeGoals++
  ) {
    const row = [];

    const homeProbability =
      poissonProbability(
        homeExpected,
        homeGoals
      );

    for (
      let awayGoals = 0;
      awayGoals <= 10;
      awayGoals++
    ) {
      const awayProbability =
        poissonProbability(
          awayExpected,
          awayGoals
        );

      row.push(
        homeProbability *
        awayProbability
      );
    }

    matrix.push(row);
  }

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestProbability = -1;
  let predictedHomeGoals = 0;
  let predictedAwayGoals = 0;

  for (
    let homeGoals = 0;
    homeGoals <= 10;
    homeGoals++
  ) {
    for (
      let awayGoals = 0;
      awayGoals <= 10;
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

        predictedHomeGoals =
          homeGoals;

        predictedAwayGoals =
          awayGoals;
      }

      if (
        homeGoals >
        awayGoals
      ) {
        homeWin +=
          probability;
      } else if (
        homeGoals ===
        awayGoals
      ) {
        draw +=
          probability;
      } else {
        awayWin +=
          probability;
      }
    }
  }

  const probabilities =
    normalizeProbabilities(
      homeWin,
      draw,
      awayWin
    );

  return {
    home:
      probabilities.home,

    draw:
      probabilities.draw,

    away:
      probabilities.away,

    expectedHomeGoals:
      homeExpected,

    expectedAwayGoals:
      awayExpected,

    predictedHomeGoals,

    predictedAwayGoals,

    predictedResult:
      predictedResult(
        probabilities
      )
  };
}

// ------------------------------------------------------------
// V0.4 PRODUCTION ASLI
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

function predictV04(
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
    new Map();

  function getRating(
    teamId
  ) {
    if (
      !ratings.has(teamId)
    ) {
      ratings.set(
        teamId,
        V04_ELO_START
      );
    }

    return ratings.get(
      teamId
    );
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

  // ----------------------------------------------------------
  // Rebuild Elo chronologically
  // ----------------------------------------------------------

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
              V04_HOME_ADVANTAGE
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

    const goalDifference =
      Math.abs(
        homeGoals -
        awayGoals
      );

    const marginMultiplier =
      getMarginMultiplier(
        goalDifference
      );

    const ratingChange =
      V04_K *
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

  const homeRating =
    getRating(
      target.home_team_id
    );

  const awayRating =
    getRating(
      target.away_team_id
    );

  const homeAverageGoals =
    priorMatches.reduce(
      (
        total,
        match
      ) =>
        total +
        Number(
          match.home_score
        ),
      0
    ) /
    priorMatches.length;

  const awayAverageGoals =
    priorMatches.reduce(
      (
        total,
        match
      ) =>
        total +
        Number(
          match.away_score
        ),
      0
    ) /
    priorMatches.length;

  const difference =
    (
      homeRating +
      V04_HOME_ADVANTAGE
    ) -
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

  let homeExpected =
    homeAverageGoals *
    homeFactor;

  let awayExpected =
    awayAverageGoals *
    awayFactor;

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

  const matrix = [];

  for (
    let homeGoals = 0;
    homeGoals <= 10;
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
      awayGoals <= 10;
      awayGoals++
    ) {
      const pAway =
        poissonProbability(
          awayExpected,
          awayGoals
        );

      row.push(
        pHome *
        pAway
      );
    }

    matrix.push(row);
  }

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  let bestProbability = -1;
  let predictedHomeGoals = 0;
  let predictedAwayGoals = 0;

  for (
    let homeGoals = 0;
    homeGoals <= 10;
    homeGoals++
  ) {
    for (
      let awayGoals = 0;
      awayGoals <= 10;
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

        predictedHomeGoals =
          homeGoals;

        predictedAwayGoals =
          awayGoals;
      }

      if (
        homeGoals >
        awayGoals
      ) {
        homeWin +=
          probability;
      } else if (
        homeGoals ===
        awayGoals
      ) {
        draw +=
          probability;
      } else {
        awayWin +=
          probability;
      }
    }
  }

  const probabilities =
    normalizeProbabilities(
      homeWin,
      draw,
      awayWin
    );

  return {
    home:
      probabilities.home,

    draw:
      probabilities.draw,

    away:
      probabilities.away,

    expectedHomeGoals:
      homeExpected,

    expectedAwayGoals:
      awayExpected,

    predictedHomeGoals,

    predictedAwayGoals,

    predictedResult:
      predictedResult(
        probabilities
      )
  };
}

// ------------------------------------------------------------
// GET PRIOR MATCHES
// ------------------------------------------------------------

function getPriorMatches(
  target,
  matches
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
// ENSEMBLE
// ------------------------------------------------------------

function predictEnsemble(
  v02,
  v04,
  v02Weight,
  v04Weight
) {
  const home =
    v02.home *
      v02Weight +
    v04.home *
      v04Weight;

  const draw =
    v02.draw *
      v02Weight +
    v04.draw *
      v04Weight;

  const away =
    v02.away *
      v02Weight +
    v04.away *
      v04Weight;

  const probabilities =
    normalizeProbabilities(
      home,
      draw,
      away
    );

  const expectedHomeGoals =
    v02.expectedHomeGoals *
      v02Weight +
    v04.expectedHomeGoals *
      v04Weight;

  const expectedAwayGoals =
    v02.expectedAwayGoals *
      v02Weight +
    v04.expectedAwayGoals *
      v04Weight;

  // ----------------------------------------------------------
  // Exact score:
  //
  // Use the ensemble expected goals to build a fresh Poisson
  // matrix. This avoids simply selecting whichever component
  // model has the highest exact-score probability.
  // ----------------------------------------------------------

  let bestProbability = -1;
  let predictedHomeGoals = 0;
  let predictedAwayGoals = 0;

  for (
    let homeGoals = 0;
    homeGoals <= 10;
    homeGoals++
  ) {
    const pHome =
      poissonProbability(
        expectedHomeGoals,
        homeGoals
      );

    for (
      let awayGoals = 0;
      awayGoals <= 10;
      awayGoals++
    ) {
      const pAway =
        poissonProbability(
          expectedAwayGoals,
          awayGoals
        );

      const probability =
        pHome *
        pAway;

      if (
        probability >
        bestProbability
      ) {
        bestProbability =
          probability;

        predictedHomeGoals =
          homeGoals;

        predictedAwayGoals =
          awayGoals;
      }
    }
  }

  return {
    home:
      probabilities.home,

    draw:
      probabilities.draw,

    away:
      probabilities.away,

    expectedHomeGoals,

    expectedAwayGoals,

    predictedHomeGoals,

    predictedAwayGoals,

    predictedResult:
      predictedResult(
        probabilities
      )
  };
}

// ------------------------------------------------------------
// LOAD DATA
// ------------------------------------------------------------

const db =
  new Database(
    DB_PATH,
    {
      readonly: true
    }
  );

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
  'ENSEMBLE WEIGHT SWEEP'
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
  `Weight variants tested : ${WEIGHT_VARIANTS.length}`
);

console.log(
  `V0.2 Home Bonus        : ${V02_HOME_GOAL_BONUS}`
);

console.log(
  `V0.4 Home Advantage    : ${V04_HOME_ADVANTAGE}`
);

console.log(
  `V0.4 Elo K             : ${V04_K}`
);

console.log('');

// ------------------------------------------------------------
// RUN WALK-FORWARD FOR EACH WEIGHT
// ------------------------------------------------------------

function runWeightVariant(
  v02Weight,
  v04Weight
) {
  const rows = [];

  for (
    const target of matches
  ) {
    const priorMatches =
      getPriorMatches(
        target,
        matches
      );

    if (
      priorMatches.length <
      HISTORY_THRESHOLD
    ) {
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

    if (
      !v02 ||
      !v04
    ) {
      continue;
    }

    const ensemble =
      predictEnsemble(
        v02,
        v04,
        v02Weight,
        v04Weight
      );

    const actualHome =
      Number(
        target.home_score
      );

    const actualAway =
      Number(
        target.away_score
      );

    const actual =
      actualResult(
        actualHome,
        actualAway
      );

    rows.push({
      target,
      v02,
      v04,
      ensemble,
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
  const n =
    rows.length;

  if (n === 0) {
    return {
      samples: 0
    };
  }

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

  let totalHomeGoals = 0;
  let totalAwayGoals = 0;

  for (
    const row of rows
  ) {
    const prediction =
      row.ensemble;

    const actual =
      row.actual;

    const actualHome =
      Number(
        row.target.home_score
      );

    const actualAway =
      Number(
        row.target.away_score
      );

    // --------------------------------------------------------
    // Accuracy
    // --------------------------------------------------------

    if (
      prediction.predictedResult ===
      actual
    ) {
      correct++;
    }

    // --------------------------------------------------------
    // Exact score
    // --------------------------------------------------------

    if (
      prediction.predictedHomeGoals ===
        actualHome &&
      prediction.predictedAwayGoals ===
        actualAway
    ) {
      exactScore++;
    }

    // --------------------------------------------------------
    // MAE
    // --------------------------------------------------------

    totalMae +=
      Math.abs(
        prediction.expectedHomeGoals -
        actualHome
      );

    totalMae +=
      Math.abs(
        prediction.expectedAwayGoals -
        actualAway
      );

    // --------------------------------------------------------
    // Brier
    //
    // Divide by 3 so this is directly comparable with
    // previous model experiments.
    // --------------------------------------------------------

    let actualVector;

    if (
      actual === 'H'
    ) {
      actualVector = [
        1,
        0,
        0
      ];

      actualH++;
    } else if (
      actual === 'D'
    ) {
      actualVector = [
        0,
        1,
        0
      ];

      actualD++;
    } else {
      actualVector = [
        0,
        0,
        1
      ];

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

    // --------------------------------------------------------
    // Prediction distribution
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Average probabilities
    // --------------------------------------------------------

    totalHomeProb +=
      prediction.home;

    totalDrawProb +=
      prediction.draw;

    totalAwayProb +=
      prediction.away;

    totalHomeGoals +=
      prediction.expectedHomeGoals;

    totalAwayGoals +=
      prediction.expectedAwayGoals;
  }

  const actualShares = {
    H:
      actualH / n,

    D:
      actualD / n,

    A:
      actualA / n
  };

  const predictedShares = {
    H:
      predictedH / n,

    D:
      predictedD / n,

    A:
      predictedA / n
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

    avgExpectedHomeGoals:
      totalHomeGoals / n,

    avgExpectedAwayGoals:
      totalAwayGoals / n,

    distributionDistance
  };
}

// ------------------------------------------------------------
// RUN ALL VARIANTS
// ------------------------------------------------------------

const results = [];

for (
  const weights of WEIGHT_VARIANTS
) {
  const rows =
    runWeightVariant(
      weights.v02,
      weights.v04
    );

  const metrics =
    calculateMetrics(
      rows
    );

  results.push({
    v02Weight:
      weights.v02,

    v04Weight:
      weights.v04,

    label:
      `${Math.round(weights.v02 * 100)}:${Math.round(weights.v04 * 100)}`,

    ...metrics
  });
}

// ------------------------------------------------------------
// COMPARISON TABLE
// ------------------------------------------------------------

console.log('');

console.log(
  '=== ENSEMBLE WEIGHT COMPARISON ==='
);

console.table(
  results.map(
    result => ({
      weight:
        result.label,

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

      avgHomeProb:
        `${(
          result.avgHomeProb *
          100
        ).toFixed(2)}%`,

      avgDrawProb:
        `${(
          result.avgDrawProb *
          100
        ).toFixed(2)}%`,

      avgAwayProb:
        `${(
          result.avgAwayProb *
          100
        ).toFixed(2)}%`,

      avgHomeGoals:
        result.avgExpectedHomeGoals
          .toFixed(2),

      avgAwayGoals:
        result.avgExpectedAwayGoals
          .toFixed(2),

      distributionDistance:
        result.distributionDistance
          .toFixed(4)
    })
  )
);

// ------------------------------------------------------------
// BEST VARIANTS
// ------------------------------------------------------------

function bestBy(
  field,
  lowerIsBetter = false
) {
  return [
    ...results
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
  '=== BEST WEIGHTS ==='
);

console.log(
  `Best Accuracy     : ${bestAccuracy.label} (${(
    bestAccuracy.accuracy *
    100
  ).toFixed(2)}%)`
);

console.log(
  `Best Exact Score  : ${bestExact.label} (${(
    bestExact.exactScore *
    100
  ).toFixed(2)}%)`
);

console.log(
  `Best MAE          : ${bestMae.label} (${bestMae.mae.toFixed(4)})`
);

console.log(
  `Best Brier        : ${bestBrier.label} (${bestBrier.brier.toFixed(4)})`
);

console.log(
  `Best Distribution : ${bestDistribution.label} (distance ${bestDistribution.distributionDistance.toFixed(4)})`
);

// ------------------------------------------------------------
// ACTUAL DISTRIBUTION
// ------------------------------------------------------------

const baseline =
  results[0];

console.log('');

console.log(
  '=== ACTUAL DISTRIBUTION ==='
);

console.log(
  `Home : ${baseline.actualH} (${(
    baseline.actualH /
    baseline.samples *
    100
  ).toFixed(2)}%)`
);

console.log(
  `Draw : ${baseline.actualD} (${(
    baseline.actualD /
    baseline.samples *
    100
  ).toFixed(2)}%)`
);

console.log(
  `Away : ${baseline.actualA} (${(
    baseline.actualA /
    baseline.samples *
    100
  ).toFixed(2)}%)`
);

// ------------------------------------------------------------
// 60:40 REFERENCE
// ------------------------------------------------------------

const reference6040 =
  results.find(
    result =>
      result.label ===
      '60:40'
  );

console.log('');

console.log(
  '=== 60:40 REFERENCE ==='
);

console.log(
  `Accuracy     : ${(
    reference6040.accuracy *
    100
  ).toFixed(2)}%`
);

console.log(
  `Exact Score  : ${(
    reference6040.exactScore *
    100
  ).toFixed(2)}%`
);

console.log(
  `MAE          : ${reference6040.mae.toFixed(4)}`
);

console.log(
  `Brier        : ${reference6040.brier.toFixed(4)}`
);

console.log(
  `H/D/A labels : ${reference6040.predictedH}/${reference6040.predictedD}/${reference6040.predictedA}`
);

// ------------------------------------------------------------
// COMPARISON AGAINST 60:40
// ------------------------------------------------------------

console.log('');

console.log(
  '=== IMPROVEMENT VS 60:40 ==='
);

console.table(
  results.map(
    result => ({
      weight:
        result.label,

      accuracyDeltaPP:
        (
          (
            result.accuracy -
            reference6040.accuracy
          ) *
          100
        ).toFixed(2),

      exactDeltaPP:
        (
          (
            result.exactScore -
            reference6040.exactScore
          ) *
          100
        ).toFixed(2),

      maeDelta:
        (
          result.mae -
          reference6040.mae
        ).toFixed(4),

      brierDelta:
        (
          result.brier -
          reference6040.brier
        ).toFixed(4),

      drawLabels:
        result.predictedD
    })
  )
);

// ------------------------------------------------------------
// FIRST 10 FOR BEST BRIER
// ------------------------------------------------------------

const bestBrierRows =
  runWeightVariant(
    bestBrier.v02Weight,
    bestBrier.v04Weight
  );

console.log('');

console.log(
  `=== FIRST 10: BEST BRIER ${bestBrier.label} ===`
);

console.table(
  bestBrierRows
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
            row.ensemble.home *
            100
          ).toFixed(1)}%`,

        drawProb:
          `${(
            row.ensemble.draw *
            100
          ).toFixed(1)}%`,

        awayProb:
          `${(
            row.ensemble.away *
            100
          ).toFixed(1)}%`,

        predicted:
          row.ensemble.predictedResult,

        expectedGoals:
          `${row.ensemble.expectedHomeGoals.toFixed(2)}-${row.ensemble.expectedAwayGoals.toFixed(2)}`
      })
    )
);

// ------------------------------------------------------------
// FIRST 10 FOR BEST ACCURACY
// ------------------------------------------------------------

const bestAccuracyRows =
  runWeightVariant(
    bestAccuracy.v02Weight,
    bestAccuracy.v04Weight
  );

console.log('');

console.log(
  `=== FIRST 10: BEST ACCURACY ${bestAccuracy.label} ===`
);

console.table(
  bestAccuracyRows
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
            row.ensemble.home *
            100
          ).toFixed(1)}%`,

        drawProb:
          `${(
            row.ensemble.draw *
            100
          ).toFixed(1)}%`,

        awayProb:
          `${(
            row.ensemble.away *
            100
          ).toFixed(1)}%`,

        predicted:
          row.ensemble.predictedResult,

        expectedGoals:
          `${row.ensemble.expectedHomeGoals.toFixed(2)}-${row.ensemble.expectedAwayGoals.toFixed(2)}`
      })
    )
);

// ------------------------------------------------------------
// SAFETY
// ------------------------------------------------------------

db.close();

console.log('');

console.log(
  '=================================================='
);

console.log(
  'ENSEMBLE WEIGHT SWEEP SELESAI'
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
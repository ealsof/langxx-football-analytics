const Database = require('better-sqlite3');

const db = new Database('./football.db', {
  readonly: true
});

// ============================================================
// CONFIG — HARUS SAMA DENGAN PRODUCTION V0.4
// ============================================================

const HISTORY_THRESHOLD = 30;

const ELO_START = 1500;
const ELO_HOME_ADVANTAGE = 60;
const ELO_K = 25;

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
// ELO HELPERS
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
// POISSON PREDICTION
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
    exactAwayGoals: bestAway,

    poissonModeHome: bestHome,
    poissonModeAway: bestAway
  };
}

// ============================================================
// V0.4 AUDIT PREDICTION
// ============================================================

function auditV04(
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
          ELO_HOME_ADVANTAGE,
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

  // ----------------------------------------------------------
  // FINAL ELO FOR TARGET
  // ----------------------------------------------------------

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
    ELO_HOME_ADVANTAGE -
    awayRating;

  const homeFactor =
    clip(
      1 +
        difference / 1000,
      0.65,
      1.35
    );

  const awayFactor =
    clip(
      1 -
        difference / 1200,
      0.65,
      1.35
    );

  // ----------------------------------------------------------
  // LEAGUE GOAL AVERAGES
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // EXPECTED GOALS
  // ----------------------------------------------------------

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

  const prediction =
    poissonPrediction(
      homeGoals,
      awayGoals
    );

  return {
    ...prediction,

    homeRating,
    awayRating,

    eloDifference:
      difference,

    homeFactor,
    awayFactor,

    leagueHomeAverage:
      homeAverage,

    leagueAwayAverage:
      awayAverage,

    historyMatches:
      finished.length
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
// MAIN AUDIT
// ============================================================

try {
  console.log(
    '\n=================================================='
  );

  console.log(
    'FOOTBALL ANALYTICS LAB'
  );

  console.log(
    'V0.4 ELO AUDIT'
  );

  console.log(
    '==================================================\n'
  );

  const matches =
    getFinishedMatches();

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
      auditV04(
        target,
        priorMatches
      );

    if (!prediction) {
      continue;
    }

    const actual =
      result(
        Number(target.home_score),
        Number(target.away_score)
      );

    rows.push({
      target,

      actual,

      prediction
    });
  }

  console.log(
    '=== DATASET ===\n'
  );

  console.log(
    `Finished matches : ${matches.length}`
  );

  console.log(
    `Audited targets  : ${rows.length}`
  );

  console.log(
    `History minimum  : ${HISTORY_THRESHOLD}`
  );

  console.log(
    `Elo start        : ${ELO_START}`
  );

  console.log(
    `Home advantage   : +${ELO_HOME_ADVANTAGE}`
  );

  console.log(
    `K factor         : ${ELO_K}`
  );

  // ==========================================================
  // RESULT DISTRIBUTION
  // ==========================================================

  const predictionDistribution =
    rows.reduce(
      (acc, row) => {
        acc[
          row.prediction.predictedResult
        ]++;

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

  console.log(
    '\n=== RESULT DISTRIBUTION ===\n'
  );

  console.log(
    'Actual:'
  );

  console.table(
    actualDistribution
  );

  console.log(
    'V0.4 prediction:'
  );

  console.table(
    predictionDistribution
  );

  // ==========================================================
  // PROBABILITY SUMMARY
  // ==========================================================

  const avgHomeProb =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.homeProb,
      0
    ) / rows.length;

  const avgDrawProb =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.drawProb,
      0
    ) / rows.length;

  const avgAwayProb =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.awayProb,
      0
    ) / rows.length;

  const avgHomeGoals =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.predictedHomeGoals,
      0
    ) / rows.length;

  const avgAwayGoals =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.predictedAwayGoals,
      0
    ) / rows.length;

  const avgHomeRating =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.homeRating,
      0
    ) / rows.length;

  const avgAwayRating =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.awayRating,
      0
    ) / rows.length;

  const avgEloDifference =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.eloDifference,
      0
    ) / rows.length;

  const avgHomeFactor =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.homeFactor,
      0
    ) / rows.length;

  const avgAwayFactor =
    rows.reduce(
      (sum, row) =>
        sum +
        row.prediction.awayFactor,
      0
    ) / rows.length;

  console.log(
    '\n=== AVERAGE V0.4 OUTPUT ===\n'
  );

  console.table({
    avgHomeProbability:
      `${(
        avgHomeProb * 100
      ).toFixed(2)}%`,

    avgDrawProbability:
      `${(
        avgDrawProb * 100
      ).toFixed(2)}%`,

    avgAwayProbability:
      `${(
        avgAwayProb * 100
      ).toFixed(2)}%`,

    avgExpectedHomeGoals:
      avgHomeGoals.toFixed(4),

    avgExpectedAwayGoals:
      avgAwayGoals.toFixed(4),

    avgHomeRating:
      avgHomeRating.toFixed(2),

    avgAwayRating:
      avgAwayRating.toFixed(2),

    avgEloDifference:
      avgEloDifference.toFixed(2),

    avgHomeFactor:
      avgHomeFactor.toFixed(4),

    avgAwayFactor:
      avgAwayFactor.toFixed(4)
  });

  // ==========================================================
  // PROBABILITY RANGES
  // ==========================================================

  function probabilityRange(
    value
  ) {
    if (value < 0.20) {
      return '<20%';
    }

    if (value < 0.30) {
      return '20–30%';
    }

    if (value < 0.40) {
      return '30–40%';
    }

    if (value < 0.50) {
      return '40–50%';
    }

    if (value < 0.60) {
      return '50–60%';
    }

    if (value < 0.70) {
      return '60–70%';
    }

    if (value < 0.80) {
      return '70–80%';
    }

    return '80%+';
  }

  const ranges = {
    home: {},
    draw: {},
    away: {}
  };

  for (const row of rows) {
    const probabilities = [
      {
        type: 'home',
        probability:
          row.prediction.homeProb
      },

      {
        type: 'draw',
        probability:
          row.prediction.drawProb
      },

      {
        type: 'away',
        probability:
          row.prediction.awayProb
      }
    ];

    for (const item of probabilities) {
      const range =
        probabilityRange(
          item.probability
        );

      if (
        !ranges[item.type][range]
      ) {
        ranges[item.type][range] = {
          n: 0,
          probabilitySum: 0,
          actualHits: 0
        };
      }

      ranges[item.type][range].n++;

      ranges[item.type][range]
        .probabilitySum +=
        item.probability;

      const actualClass =
        item.type === 'home'
          ? 'H'
          : item.type === 'draw'
            ? 'D'
            : 'A';

      if (
        row.actual ===
        actualClass
      ) {
        ranges[item.type][range]
          .actualHits++;
      }
    }
  }

  console.log(
    '\n=== HOME PROBABILITY RANGES ===\n'
  );

  for (
    const [range, data] of
    Object.entries(
      ranges.home
    )
  ) {
    console.log(
      `${range}: n=${data.n}, avg=${(
        data.probabilitySum /
        data.n *
        100
      ).toFixed(2)}%, actual=${(
        data.actualHits /
        data.n *
        100
      ).toFixed(2)}%`
    );
  }

  console.log(
    '\n=== DRAW PROBABILITY RANGES ===\n'
  );

  for (
    const [range, data] of
    Object.entries(
      ranges.draw
    )
  ) {
    console.log(
      `${range}: n=${data.n}, avg=${(
        data.probabilitySum /
        data.n *
        100
      ).toFixed(2)}%, actual=${(
        data.actualHits /
        data.n *
        100
      ).toFixed(2)}%`
    );
  }

  console.log(
    '\n=== AWAY PROBABILITY RANGES ===\n'
  );

  for (
    const [range, data] of
    Object.entries(
      ranges.away
    )
  ) {
    console.log(
      `${range}: n=${data.n}, avg=${(
        data.probabilitySum /
        data.n *
        100
      ).toFixed(2)}%, actual=${(
        data.actualHits /
        data.n *
        100
      ).toFixed(2)}%`
    );
  }

  // ==========================================================
  // FIRST 20 CASES
  // ==========================================================

  console.log(
    '\n=== FIRST 20 V0.4 CASES ===\n'
  );

  console.table(
    rows
      .slice(0, 20)
      .map(
        (row, index) => ({
          no:
            index + 1,

          match:
            `${row.target.home_team} vs ${row.target.away_team}`,

          competition:
            row.target.competition,

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
            `${row.prediction.predictedHomeGoals.toFixed(2)}-${row.prediction.predictedAwayGoals.toFixed(2)}`,

          eloHome:
            row.prediction.homeRating.toFixed(1),

          eloAway:
            row.prediction.awayRating.toFixed(1),

          eloDiff:
            row.prediction.eloDifference.toFixed(1),

          homeFactor:
            row.prediction.homeFactor.toFixed(3),

          awayFactor:
            row.prediction.awayFactor.toFixed(3)
        })
      )
  );

  // ==========================================================
  // MOST EXTREME HOME BIAS CASES
  // ==========================================================

  console.log(
    '\n=== 10 HIGHEST HOME PROBABILITY CASES ===\n'
  );

  console.table(
    [...rows]
      .sort(
        (a, b) =>
          b.prediction.homeProb -
          a.prediction.homeProb
      )
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

          eloDiff:
            row.prediction.eloDifference.toFixed(1),

          homeFactor:
            row.prediction.homeFactor.toFixed(3),

          awayFactor:
            row.prediction.awayFactor.toFixed(3)
        })
      )
  );

  // ==========================================================
  // HIGHEST AWAY PROBABILITY CASES
  // ==========================================================

  console.log(
    '\n=== 10 HIGHEST AWAY PROBABILITY CASES ===\n'
  );

  console.table(
    [...rows]
      .sort(
        (a, b) =>
          b.prediction.awayProb -
          a.prediction.awayProb
      )
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

          eloDiff:
            row.prediction.eloDifference.toFixed(1),

          homeFactor:
            row.prediction.homeFactor.toFixed(3),

          awayFactor:
            row.prediction.awayFactor.toFixed(3)
        })
      )
  );

  // ==========================================================
  // COMPETITION BREAKDOWN
  // ==========================================================

  const competitionStats = {};

  for (const row of rows) {
    const competition =
      row.target.competition;

    if (
      !competitionStats[
        competition
      ]
    ) {
      competitionStats[
        competition
      ] = {
        n: 0,
        homeProb: 0,
        drawProb: 0,
        awayProb: 0,
        predictedHome: 0,
        predictedDraw: 0,
        predictedAway: 0
      };
    }

    const item =
      competitionStats[
        competition
      ];

    item.n++;

    item.homeProb +=
      row.prediction.homeProb;

    item.drawProb +=
      row.prediction.drawProb;

    item.awayProb +=
      row.prediction.awayProb;

    if (
      row.prediction.predictedResult ===
      'H'
    ) {
      item.predictedHome++;
    }

    if (
      row.prediction.predictedResult ===
      'D'
    ) {
      item.predictedDraw++;
    }

    if (
      row.prediction.predictedResult ===
      'A'
    ) {
      item.predictedAway++;
    }
  }

  console.log(
    '\n=== COMPETITION BREAKDOWN ===\n'
  );

  console.table(
    Object.entries(
      competitionStats
    ).map(
      ([competition, data]) => ({
        competition,

        n:
          data.n,

        avgHomeProb:
          `${(
            data.homeProb /
            data.n *
            100
          ).toFixed(2)}%`,

        avgDrawProb:
          `${(
            data.drawProb /
            data.n *
            100
          ).toFixed(2)}%`,

        avgAwayProb:
          `${(
            data.awayProb /
            data.n *
            100
          ).toFixed(2)}%`,

        predictedH:
          data.predictedHome,

        predictedD:
          data.predictedDraw,

        predictedA:
          data.predictedAway
      })
    )
  );

  console.log(
    '\n=================================================='
  );

  console.log(
    'V0.4 AUDIT SELESAI'
  );

  console.log(
    'Database tidak diubah.'
  );

  console.log(
    '==================================================\n'
  );

} catch (error) {
  console.error(
    '\nAudit V0.4 gagal:',
    error.message
  );

  process.exitCode = 1;

} finally {
  db.close();
}
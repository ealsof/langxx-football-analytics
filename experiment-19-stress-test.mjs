import Database from "better-sqlite3";

const db = new Database("football.db", {
  readonly: true
});

const THRESHOLD = 30;

const V02_WEIGHT = 0.60;
const V04_WEIGHT = 0.40;

const MIN_HISTORY_RECENT = 10;

// ============================================================
// BASIC HELPERS
// ============================================================

function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poisson(lambda, k) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial(k)
  );
}

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

  const total =
    homeWin +
    draw +
    awayWin;

  return {
    homeProb: homeWin / total,
    drawProb: draw / total,
    awayProb: awayWin / total,
    expectedHomeGoals: homeGoals,
    expectedAwayGoals: awayGoals
  };
}

function actualResult(home, away) {
  if (home > away) return "H";
  if (home === away) return "D";
  return "A";
}

function predictedResult(prediction) {
  if (
    prediction.homeProb >=
      prediction.drawProb &&
    prediction.homeProb >=
      prediction.awayProb
  ) {
    return "H";
  }

  if (
    prediction.drawProb >=
    prediction.awayProb
  ) {
    return "D";
  }

  return "A";
}

// ============================================================
// LEAGUE STATS
// ============================================================

function getLeagueStats(
  history,
  multiplier = 1
) {
  if (history.length === 0) {
    return {
      homeGoals: 1.4,
      awayGoals: 1.1,
      games: 0
    };
  }

  const totalHomeGoals =
    history.reduce(
      (sum, match) =>
        sum + match.home_score,
      0
    );

  const totalAwayGoals =
    history.reduce(
      (sum, match) =>
        sum + match.away_score,
      0
    );

  const games = history.length;

  return {
    homeGoals:
      (
        totalHomeGoals /
        games
      ) * multiplier,

    awayGoals:
      (
        totalAwayGoals /
        games
      ) * multiplier,

    games
  };
}

// ============================================================
// TEAM STATS
// ============================================================

function getTeamStats(
  history,
  team
) {
  let goalsFor = 0;
  let goalsAgainst = 0;
  let games = 0;

  for (const match of history) {
    if (
      match.home_team === team
    ) {
      goalsFor += match.home_score;
      goalsAgainst += match.away_score;
      games++;
    }

    if (
      match.away_team === team
    ) {
      goalsFor += match.away_score;
      goalsAgainst += match.home_score;
      games++;
    }
  }

  return {
    goalsFor,
    goalsAgainst,
    games
  };
}

// ============================================================
// V0.2
// ============================================================

function predictV02(
  target,
  history,
  leagueMultiplier = 1
) {
  const league =
    getLeagueStats(
      history,
      leagueMultiplier
    );

  const home =
    getTeamStats(
      history,
      target.home_team
    );

  const away =
    getTeamStats(
      history,
      target.away_team
    );

  const homeAttack =
    home.goalsFor /
    Math.max(
      league.homeGoals *
        home.games,
      0.1
    );

  const awayAttack =
    away.goalsFor /
    Math.max(
      league.awayGoals *
        away.games,
      0.1
    );

  const homeDefense =
    home.goalsAgainst /
    Math.max(
      league.awayGoals *
        home.games,
      0.1
    );

  const awayDefense =
    away.goalsAgainst /
    Math.max(
      league.homeGoals *
        away.games,
      0.1
    );

  let homeGoals =
    league.homeGoals *
    homeAttack *
    awayDefense;

  let awayGoals =
    league.awayGoals *
    awayAttack *
    homeDefense;

  homeGoals *= 1.05;

  homeGoals = Math.max(
    0.2,
    Math.min(
      homeGoals,
      4.5
    )
  );

  awayGoals = Math.max(
    0.2,
    Math.min(
      awayGoals,
      4.5
    )
  );

  return poissonPrediction(
    homeGoals,
    awayGoals
  );
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
        (ratingB - ratingA) /
          400
      )
    )
  );
}

function buildRatings(history) {
  const ratings =
    new Map();

  const prepared = [];

  for (const match of history) {
    if (
      !ratings.has(
        match.home_team
      )
    ) {
      ratings.set(
        match.home_team,
        1500
      );
    }

    if (
      !ratings.has(
        match.away_team
      )
    ) {
      ratings.set(
        match.away_team,
        1500
      );
    }

    const homeRating =
      ratings.get(
        match.home_team
      );

    const awayRating =
      ratings.get(
        match.away_team
      );

    prepared.push({
      ...match,
      homeRating,
      awayRating
    });

    const expectedHome =
      eloExpected(
        homeRating + 60,
        awayRating
      );

    const actualHome =
      match.home_score >
      match.away_score
        ? 1
        : match.home_score ===
            match.away_score
          ? 0.5
          : 0;

    const margin =
      Math.abs(
        match.home_score -
        match.away_score
      );

    let marginMultiplier = 1;

    if (margin === 2) {
      marginMultiplier = 1.25;
    } else if (
      margin >= 3
    ) {
      marginMultiplier = 1.5;
    }

    const K =
      25 *
      marginMultiplier;

    const delta =
      K *
      (
        actualHome -
        expectedHome
      );

    ratings.set(
      match.home_team,
      homeRating + delta
    );

    ratings.set(
      match.away_team,
      awayRating - delta
    );
  }

  return {
    prepared,
    ratings
  };
}

// ============================================================
// V0.4
// ============================================================

function predictV04(
  target,
  history,
  leagueMultiplier = 1
) {
  const {
    ratings
  } = buildRatings(history);

  const league =
    getLeagueStats(
      history,
      leagueMultiplier
    );

  const homeRating =
    ratings.has(
      target.home_team
    )
      ? ratings.get(
          target.home_team
        )
      : 1500;

  const awayRating =
    ratings.has(
      target.away_team
    )
      ? ratings.get(
          target.away_team
        )
      : 1500;

  const difference =
    homeRating +
    60 -
    awayRating;

  let homeFactor =
    1 +
    difference /
      1000;

  let awayFactor =
    1 -
    difference /
      1200;

  homeFactor =
    Math.max(
      0.65,
      Math.min(
        homeFactor,
        1.35
      )
    );

  awayFactor =
    Math.max(
      0.65,
      Math.min(
        awayFactor,
        1.35
      )
    );

  let homeGoals =
    league.homeGoals *
    homeFactor;

  let awayGoals =
    league.awayGoals *
    awayFactor;

  homeGoals =
    Math.max(
      0.2,
      Math.min(
        homeGoals,
        4.5
      )
    );

  awayGoals =
    Math.max(
      0.2,
      Math.min(
        awayGoals,
        4.5
      )
    );

  return poissonPrediction(
    homeGoals,
    awayGoals
  );
}

// ============================================================
// ENSEMBLE
// ============================================================

function ensemble(
  v02,
  v04
) {
  return {
    homeProb:
      V02_WEIGHT *
        v02.homeProb +
      V04_WEIGHT *
        v04.homeProb,

    drawProb:
      V02_WEIGHT *
        v02.drawProb +
      V04_WEIGHT *
        v04.drawProb,

    awayProb:
      V02_WEIGHT *
        v02.awayProb +
      V04_WEIGHT *
        v04.awayProb,

    expectedHomeGoals:
      V02_WEIGHT *
        v02.expectedHomeGoals +
      V04_WEIGHT *
        v04.expectedHomeGoals,

    expectedAwayGoals:
      V02_WEIGHT *
        v02.expectedAwayGoals +
      V04_WEIGHT *
        v04.expectedAwayGoals
  };
}

// ============================================================
// STRESS HISTORY GENERATORS
// ============================================================

function normalHistory(
  history
) {
  return [
    ...history
  ];
}

function recent10History(
  history
) {
  return history.slice(
    -MIN_HISTORY_RECENT
  );
}

function remove20PercentLatest(
  history
) {
  if (
    history.length <=
    THRESHOLD
  ) {
    return [
      ...history
    ];
  }

  const removeCount =
    Math.max(
      1,
      Math.floor(
        history.length *
          0.20
      )
    );

  return history.slice(
    0,
    history.length -
      removeCount
  );
}

// ============================================================
// METRICS
// ============================================================

function brierScore(
  prediction,
  actual
) {
  const homeActual =
    actual === "H"
      ? 1
      : 0;

  const drawActual =
    actual === "D"
      ? 1
      : 0;

  const awayActual =
    actual === "A"
      ? 1
      : 0;

  return (
    Math.pow(
      prediction.homeProb -
        homeActual,
      2
    ) +
    Math.pow(
      prediction.drawProb -
        drawActual,
      2
    ) +
    Math.pow(
      prediction.awayProb -
        awayActual,
      2
    )
  ) / 3;
}

function goalMAE(
  prediction,
  target
) {
  return (
    Math.abs(
      prediction.expectedHomeGoals -
        target.home_score
    ) +
    Math.abs(
      prediction.expectedAwayGoals -
        target.away_score
    )
  ) / 2;
}

function calculateMetrics(
  rows
) {
  if (
    rows.length === 0
  ) {
    return {
      n: 0,
      accuracy: 0,
      exact: 0,
      mae: 0,
      brier: 0
    };
  }

  let correct = 0;
  let exact = 0;
  let mae = 0;
  let brier = 0;

  for (const row of rows) {
    const predicted =
      predictedResult(
        row.prediction
      );

    if (
      predicted === row.actual
    ) {
      correct++;
    }

    const predictedHome =
      Math.round(
        row.prediction
          .expectedHomeGoals
      );

    const predictedAway =
      Math.round(
        row.prediction
          .expectedAwayGoals
      );

    if (
      predictedHome ===
        row.target.home_score &&
      predictedAway ===
        row.target.away_score
    ) {
      exact++;
    }

    mae += goalMAE(
      row.prediction,
      row.target
    );

    brier += brierScore(
      row.prediction,
      row.actual
    );
  }

  return {
    n: rows.length,

    accuracy:
      (
        correct /
        rows.length
      ) * 100,

    exact:
      (
        exact /
        rows.length
      ) * 100,

    mae:
      mae /
      rows.length,

    brier:
      brier /
      rows.length
  };
}

// ============================================================
// PREDICTION FOR ONE TARGET
// ============================================================

function predictAll(
  target,
  history,
  leagueMultiplier
) {
  const v02 =
    predictV02(
      target,
      history,
      leagueMultiplier
    );

  const v04 =
    predictV04(
      target,
      history,
      leagueMultiplier
    );

  const combined =
    ensemble(
      v02,
      v04
    );

  return {
    "V0.2": v02,
    "V0.4": v04,
    "60:40": combined
  };
}

// ============================================================
// LOAD MATCHES
// ============================================================

const matches = db.prepare(`
  SELECT
    id,
    competition,
    kickoff,
    home_team,
    away_team,
    home_score,
    away_score,
    status
  FROM matches
  WHERE LOWER(status) = 'finished'
    AND home_score IS NOT NULL
    AND away_score IS NOT NULL
    AND kickoff IS NOT NULL
  ORDER BY kickoff ASC
`).all();

const competitions = [
  "Premier League",
  "La Liga"
];

const scenarios = [
  {
    name: "NORMAL",

    buildHistory(history) {
      return normalHistory(
        history
      );
    },

    leagueMultiplier: 1
  },

  {
    name: "RECENT-10",

    buildHistory(history) {
      return recent10History(
        history
      );
    },

    leagueMultiplier: 1
  },

  {
    name: "REMOVE-20%",

    buildHistory(history) {
      return remove20PercentLatest(
        history
      );
    },

    leagueMultiplier: 1
  },

  {
    name: "LEAGUE-DOWN-10%",

    buildHistory(history) {
      return normalHistory(
        history
      );
    },

    leagueMultiplier: 0.90
  },

  {
    name: "LEAGUE-UP-10%",

    buildHistory(history) {
      return normalHistory(
        history
      );
    },

    leagueMultiplier: 1.10
  }
];

// ============================================================
// RUN EXPERIMENT
// ============================================================

const allResults = [];

for (
  const competition of
  competitions
) {
  const competitionMatches =
    matches.filter(
      match =>
        match.competition ===
        competition
    );

  const eligibleTargets =
    competitionMatches.slice(
      THRESHOLD
    );

  console.log("\n");
  console.log(
    "============================================"
  );

  console.log(
    `COMPETITION: ${competition}`
  );

  console.log(
    "============================================"
  );

  console.log(
    `Total finished matches : ${competitionMatches.length}`
  );

  console.log(
    `Eligible targets       : ${eligibleTargets.length}`
  );

  for (
    const scenario of
    scenarios
  ) {
    const scenarioRows = {
      "V0.2": [],
      "V0.4": [],
      "60:40": []
    };

    for (
      let i = THRESHOLD;
      i <
        competitionMatches.length;
      i++
    ) {
      const target =
        competitionMatches[i];

      const fullHistory =
        competitionMatches.slice(
          0,
          i
        );

      if (
        fullHistory.length <
        THRESHOLD
      ) {
        continue;
      }

      const stressedHistory =
        scenario.buildHistory(
          fullHistory
        );

      // Recent-10 is intentionally allowed
      // to use fewer than 30 matches.
      // The point of this scenario is testing
      // sensitivity to a very limited recent sample.
      if (
        stressedHistory.length ===
        0
      ) {
        continue;
      }

      const predictions =
        predictAll(
          target,
          stressedHistory,
          scenario.leagueMultiplier
        );

      const actual =
        actualResult(
          target.home_score,
          target.away_score
        );

      for (
        const model of
        Object.keys(
          scenarioRows
        )
      ) {
        scenarioRows[
          model
        ].push({
          target,
          actual,
          prediction:
            predictions[model]
        });
      }
    }

    console.log("\n--------------------------------------------");
    console.log(
      `SCENARIO: ${scenario.name}`
    );
    console.log("--------------------------------------------");

    for (
      const model of
      Object.keys(
        scenarioRows
      )
    ) {
      const metrics =
        calculateMetrics(
          scenarioRows[model]
        );

      allResults.push({
        competition,
        scenario:
          scenario.name,
        model,
        metrics
      });

      console.log(
        `${model.padEnd(6)} | ` +
        `N=${String(metrics.n).padStart(2)} | ` +
        `Acc=${metrics.accuracy.toFixed(2)}% | ` +
        `Exact=${metrics.exact.toFixed(2)}% | ` +
        `MAE=${metrics.mae.toFixed(4)} | ` +
        `Brier=${metrics.brier.toFixed(4)}`
      );
    }
  }
}

// ============================================================
// COMBINED RESULTS
// ============================================================

console.log("\n\n");
console.log(
  "============================================"
);

console.log(
  "COMBINED STRESS TEST"
);

console.log(
  "============================================"
);

const combinedGroups = {};

for (
  const result of
  allResults
) {
  const key =
    `${result.scenario}|${result.model}`;

  if (
    !combinedGroups[key]
  ) {
    combinedGroups[key] = [];
  }

  combinedGroups[key].push(
    result
  );
}

for (
  const scenario of
  scenarios
) {
  console.log("\n--------------------------------------------");

  console.log(
    `SCENARIO: ${scenario.name}`
  );

  console.log(
    "--------------------------------------------");

  for (
    const model of
    ["V0.2", "V0.4", "60:40"]
  ) {
    const results =
      allResults.filter(
        result =>
          result.scenario ===
            scenario.name &&
          result.model ===
            model
      );

    const totalN =
      results.reduce(
        (sum, result) =>
          sum +
          result.metrics.n,
        0
      );

    if (
      totalN === 0
    ) {
      continue;
    }

    const accuracy =
      results.reduce(
        (sum, result) =>
          sum +
          (
            result.metrics.accuracy /
            100
          ) *
          result.metrics.n,
        0
      ) /
      totalN *
      100;

    const exact =
      results.reduce(
        (sum, result) =>
          sum +
          (
            result.metrics.exact /
            100
          ) *
          result.metrics.n,
        0
      ) /
      totalN *
      100;

    const mae =
      results.reduce(
        (sum, result) =>
          sum +
          result.metrics.mae *
          result.metrics.n,
        0
      ) /
      totalN;

    const brier =
      results.reduce(
        (sum, result) =>
          sum +
          result.metrics.brier *
          result.metrics.n,
        0
      ) /
      totalN;

    console.log(
      `${model.padEnd(6)} | ` +
      `N=${String(totalN).padStart(2)} | ` +
      `Acc=${accuracy.toFixed(2)}% | ` +
      `Exact=${exact.toFixed(2)}% | ` +
      `MAE=${mae.toFixed(4)} | ` +
      `Brier=${brier.toFixed(4)}`
    );
  }
}

// ============================================================
// ROBUSTNESS SUMMARY FOR 60:40
// ============================================================

console.log("\n\n");
console.log(
  "============================================"
);

console.log(
  "60:40 ROBUSTNESS SUMMARY"
);

console.log(
  "============================================"
);

for (
  const competition of
  competitions
) {
  console.log("\n");
  console.log(
    `COMPETITION: ${competition}`
  );

  const baseline =
    allResults.find(
      result =>
        result.competition ===
          competition &&
        result.scenario ===
          "NORMAL" &&
        result.model ===
          "60:40"
    );

  if (!baseline) {
    continue;
  }

  console.log(
    `Normal baseline -> ` +
    `Acc ${baseline.metrics.accuracy.toFixed(2)}% | ` +
    `MAE ${baseline.metrics.mae.toFixed(4)} | ` +
    `Brier ${baseline.metrics.brier.toFixed(4)}`
  );

  for (
    const scenario of
    scenarios
  ) {
    if (
      scenario.name ===
      "NORMAL"
    ) {
      continue;
    }

    const result =
      allResults.find(
        item =>
          item.competition ===
            competition &&
          item.scenario ===
            scenario.name &&
          item.model ===
            "60:40"
      );

    if (!result) {
      continue;
    }

    const accuracyDelta =
      result.metrics.accuracy -
      baseline.metrics.accuracy;

    const maeDelta =
      result.metrics.mae -
      baseline.metrics.mae;

    const brierDelta =
      result.metrics.brier -
      baseline.metrics.brier;

    console.log(
      `${scenario.name.padEnd(18)} | ` +
      `Acc Δ=${accuracyDelta >= 0 ? "+" : ""}${accuracyDelta.toFixed(2)} pp | ` +
      `MAE Δ=${maeDelta >= 0 ? "+" : ""}${maeDelta.toFixed(4)} | ` +
      `Brier Δ=${brierDelta >= 0 ? "+" : ""}${brierDelta.toFixed(4)}`
    );
  }
}

// ============================================================
// FINAL NOTES
// ============================================================

console.log("\n\n");
console.log(
  "============================================"
);

console.log(
  "EXPERIMENT #19 COMPLETE"
);

console.log(
  "============================================"
);

console.log(
  "DB mode: READ ONLY"
);

console.log(
  "Production model: UNCHANGED"
);

console.log(
  "No calibration layer was applied."
);

console.log(
  "60:40 weights remained fixed at 60% V0.2 + 40% V0.4."
);

console.log(
  "Stress tests measure robustness, not model selection."
);

db.close();
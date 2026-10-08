import Database from "better-sqlite3";

const db = new Database("football.db", {
  readonly: true
});

const THRESHOLD = 30;

/*
==================================================
LOAD MATCHES
==================================================
*/

const matches = db.prepare(`
  SELECT
    id,
    home_team,
    away_team,
    competition,
    kickoff,
    home_score,
    away_score
  FROM matches
  WHERE status = 'finished'
    AND home_score IS NOT NULL
    AND away_score IS NOT NULL
  ORDER BY kickoff ASC
`).all();

/*
==================================================
HELPERS
==================================================
*/

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

function actualResult(home, away) {
  if (home > away) return "H";
  if (home === away) return "D";
  return "A";
}

function predictedResult(prediction) {
  if (
    prediction.homeProb >= prediction.drawProb &&
    prediction.homeProb >= prediction.awayProb
  ) {
    return "H";
  }

  if (
    prediction.drawProb >= prediction.awayProb
  ) {
    return "D";
  }

  return "A";
}

/*
==================================================
LEAGUE STATS
==================================================
*/

function leagueStats(competition, previous) {

  const data = previous.filter(
    m => m.competition === competition
  );

  if (!data.length) {
    return {
      homeGoals: 1.45,
      awayGoals: 1.15
    };
  }

  let homeGoals = 0;
  let awayGoals = 0;

  for (const m of data) {
    homeGoals += m.home_score;
    awayGoals += m.away_score;
  }

  return {
    homeGoals: homeGoals / data.length,
    awayGoals: awayGoals / data.length
  };
}

/*
==================================================
POISSON
==================================================
*/

function poissonPrediction(homeGoals, awayGoals) {

  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;

  for (let hg = 0; hg <= 7; hg++) {

    for (let ag = 0; ag <= 7; ag++) {

      const probability =
        poisson(homeGoals, hg) *
        poisson(awayGoals, ag);

      if (hg > ag) {
        homeProb += probability;
      } else if (hg === ag) {
        drawProb += probability;
      } else {
        awayProb += probability;
      }
    }
  }

  const total =
    homeProb +
    drawProb +
    awayProb;

  return {
    homeGoals,
    awayGoals,
    homeProb: homeProb / total,
    drawProb: drawProb / total,
    awayProb: awayProb / total
  };
}

/*
==================================================
V02
==================================================
*/

function predictV02(
  homeTeam,
  awayTeam,
  competition,
  previous
) {

  const league =
    leagueStats(
      competition,
      previous
    );

  const home = {
    goalsFor: 0,
    goalsAgainst: 0,
    matches: 0
  };

  const away = {
    goalsFor: 0,
    goalsAgainst: 0,
    matches: 0
  };

  for (const m of previous) {

    if (m.competition !== competition) {
      continue;
    }

    if (m.home_team === homeTeam) {
      home.goalsFor += m.home_score;
      home.goalsAgainst += m.away_score;
      home.matches++;
    }

    if (m.away_team === homeTeam) {
      home.goalsFor += m.away_score;
      home.goalsAgainst += m.home_score;
      home.matches++;
    }

    if (m.home_team === awayTeam) {
      away.goalsFor += m.home_score;
      away.goalsAgainst += m.away_score;
      away.matches++;
    }

    if (m.away_team === awayTeam) {
      away.goalsFor += m.away_score;
      away.goalsAgainst += m.home_score;
      away.matches++;
    }
  }

  if (
    home.matches === 0 ||
    away.matches === 0
  ) {
    return {
      homeGoals: league.homeGoals,
      awayGoals: league.awayGoals,
      homeProb: 0.4118,
      drawProb: 0.2773,
      awayProb: 0.3109
    };
  }

  const homeAttack =
    (home.goalsFor / home.matches) /
    Math.max(league.homeGoals, 0.1);

  const awayAttack =
    (away.goalsFor / away.matches) /
    Math.max(league.awayGoals, 0.1);

  const homeDefense =
    (home.goalsAgainst / home.matches) /
    Math.max(league.awayGoals, 0.1);

  const awayDefense =
    (away.goalsAgainst / away.matches) /
    Math.max(league.homeGoals, 0.1);

  let homeGoals =
    league.homeGoals *
    homeAttack *
    awayDefense;

  let awayGoals =
    league.awayGoals *
    awayAttack *
    homeDefense;

  homeGoals *= 1.05;

  homeGoals =
    Math.max(
      0.2,
      Math.min(homeGoals, 4.5)
    );

  awayGoals =
    Math.max(
      0.2,
      Math.min(awayGoals, 4.5)
    );

  return poissonPrediction(
    homeGoals,
    awayGoals
  );
}

/*
==================================================
ELO
==================================================
*/

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

function calculateElo(
  competition,
  previous
) {

  const ratings = {};

  function getRating(team) {

    if (!(team in ratings)) {
      ratings[team] = 1500;
    }

    return ratings[team];
  }

  const kFactor = 25;
  const homeAdvantage = 60;

  for (const m of previous) {

    if (m.competition !== competition) {
      continue;
    }

    const homeRating =
      getRating(m.home_team);

    const awayRating =
      getRating(m.away_team);

    const expected =
      eloExpected(
        homeRating + homeAdvantage,
        awayRating
      );

    let actualScore;

    if (m.home_score > m.away_score) {
      actualScore = 1;
    } else if (m.home_score === m.away_score) {
      actualScore = 0.5;
    } else {
      actualScore = 0;
    }

    const margin =
      Math.abs(
        m.home_score -
        m.away_score
      );

    let multiplier = 1;

    if (margin === 2) {
      multiplier = 1.25;
    } else if (margin >= 3) {
      multiplier = 1.50;
    }

    const change =
      kFactor *
      multiplier *
      (
        actualScore -
        expected
      );

    ratings[m.home_team] += change;
    ratings[m.away_team] -= change;
  }

  return ratings;
}

/*
==================================================
V04
==================================================
*/

function predictV04(
  homeTeam,
  awayTeam,
  competition,
  previous
) {

  const league =
    leagueStats(
      competition,
      previous
    );

  const ratings =
    calculateElo(
      competition,
      previous
    );

  const homeRating =
    ratings[homeTeam] ?? 1500;

  const awayRating =
    ratings[awayTeam] ?? 1500;

  const difference =
    homeRating +
    60 -
    awayRating;

  const homeFactor =
    Math.max(
      0.65,
      Math.min(
        1.35,
        1 +
        difference / 1000
      )
    );

  const awayFactor =
    Math.max(
      0.65,
      Math.min(
        1.35,
        1 -
        difference / 1200
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
      Math.min(homeGoals, 4.5)
    );

  awayGoals =
    Math.max(
      0.2,
      Math.min(awayGoals, 4.5)
    );

  return poissonPrediction(
    homeGoals,
    awayGoals
  );
}

/*
==================================================
WEIGHTED ENSEMBLE
==================================================
*/

function predictWeightedEnsemble(
  homeTeam,
  awayTeam,
  competition,
  previous,
  weightV02
) {

  const v02 =
    predictV02(
      homeTeam,
      awayTeam,
      competition,
      previous
    );

  const v04 =
    predictV04(
      homeTeam,
      awayTeam,
      competition,
      previous
    );

  const weightV04 =
    1 - weightV02;

  return {
    homeGoals:
      (v02.homeGoals * weightV02) +
      (v04.homeGoals * weightV04),

    awayGoals:
      (v02.awayGoals * weightV02) +
      (v04.awayGoals * weightV04),

    homeProb:
      (v02.homeProb * weightV02) +
      (v04.homeProb * weightV04),

    drawProb:
      (v02.drawProb * weightV02) +
      (v04.drawProb * weightV04),

    awayProb:
      (v02.awayProb * weightV02) +
      (v04.awayProb * weightV04)
  };
}

/*
==================================================
METRICS
==================================================
*/

function createMetric() {
  return {
    tests: 0,
    correct: 0,
    exact: 0,
    goalError: 0,
    brier: 0
  };
}

function evaluateMetric(
  metric,
  prediction,
  actualHome,
  actualAway
) {

  metric.tests++;

  const actual =
    actualResult(
      actualHome,
      actualAway
    );

  const predicted =
    predictedResult(
      prediction
    );

  if (actual === predicted) {
    metric.correct++;
  }

  const predictedHome =
    Math.round(prediction.homeGoals);

  const predictedAway =
    Math.round(prediction.awayGoals);

  if (
    predictedHome === actualHome &&
    predictedAway === actualAway
  ) {
    metric.exact++;
  }

  metric.goalError +=
    (
      Math.abs(
        prediction.homeGoals -
        actualHome
      ) +
      Math.abs(
        prediction.awayGoals -
        actualAway
      )
    ) / 2;

  const actualHomeValue =
    actual === "H" ? 1 : 0;

  const actualDrawValue =
    actual === "D" ? 1 : 0;

  const actualAwayValue =
    actual === "A" ? 1 : 0;

  metric.brier +=
    Math.pow(
      prediction.homeProb -
      actualHomeValue,
      2
    ) +

    Math.pow(
      prediction.drawProb -
      actualDrawValue,
      2
    ) +

    Math.pow(
      prediction.awayProb -
      actualAwayValue,
      2
    );
}

function finalizeMetric(metric) {

  if (!metric.tests) {
    return {
      accuracy: 0,
      exact: 0,
      goalMAE: 0,
      brier: 0,
      tests: 0
    };
  }

  return {
    tests: metric.tests,

    accuracy:
      metric.correct /
      metric.tests,

    exact:
      metric.exact /
      metric.tests,

    goalMAE:
      metric.goalError /
      metric.tests,

    brier:
      metric.brier /
      metric.tests
  };
}

/*
==================================================
WEIGHT CONFIGURATION
==================================================
*/

const weights = [
  0.70,
  0.60,
  0.50,
  0.40,
  0.30
];

/*
==================================================
WALK-FORWARD WEIGHTED ENSEMBLE
==================================================
*/

const metrics = {
  V02: createMetric(),
  V04: createMetric()
};

for (const weight of weights) {
  metrics[`ENSEMBLE_${weight}`] =
    createMetric();
}

let skipped = 0;

for (let i = 0; i < matches.length; i++) {

  const match = matches[i];

  const previous =
    matches.filter(
      m =>
        new Date(m.kickoff) <
        new Date(match.kickoff)
    );

  const competitionHistory =
    previous.filter(
      m =>
        m.competition ===
        match.competition
    );

  /*
  -----------------------------------------------
  THRESHOLD
  -----------------------------------------------
  */

  if (
    competitionHistory.length <
    THRESHOLD
  ) {
    skipped++;
    continue;
  }

  /*
  -----------------------------------------------
  V02
  -----------------------------------------------
  */

  const v02 =
    predictV02(
      match.home_team,
      match.away_team,
      match.competition,
      previous
    );

  /*
  -----------------------------------------------
  V04
  -----------------------------------------------
  */

  const v04 =
    predictV04(
      match.home_team,
      match.away_team,
      match.competition,
      previous
    );

  /*
  -----------------------------------------------
  EVALUATE V02
  -----------------------------------------------
  */

  evaluateMetric(
    metrics.V02,
    v02,
    match.home_score,
    match.away_score
  );

  /*
  -----------------------------------------------
  EVALUATE V04
  -----------------------------------------------
  */

  evaluateMetric(
    metrics.V04,
    v04,
    match.home_score,
    match.away_score
  );

  /*
  -----------------------------------------------
  WEIGHTED ENSEMBLES
  -----------------------------------------------
  */

  for (const weight of weights) {

    const ensemble =
      predictWeightedEnsemble(
        match.home_team,
        match.away_team,
        match.competition,
        previous,
        weight
      );

    evaluateMetric(
      metrics[`ENSEMBLE_${weight}`],
      ensemble,
      match.home_score,
      match.away_score
    );
  }
}

/*
==================================================
RESULT
==================================================
*/

const result = {
  V02: finalizeMetric(metrics.V02),
  V04: finalizeMetric(metrics.V04)
};

for (const weight of weights) {
  result[`ENSEMBLE_${weight}`] =
    finalizeMetric(
      metrics[`ENSEMBLE_${weight}`]
    );
}

/*
==================================================
DISPLAY
==================================================
*/

console.log("");

console.log("==================================================");
console.log("EXPERIMENT #9 — WEIGHTED ENSEMBLE");
console.log("==================================================");

console.log("");

console.log(`Threshold : ${THRESHOLD}`);
console.log(`Total matches : ${matches.length}`);
console.log(`Skipped : ${skipped}`);

console.log("");

const output = {
  V02: {
    Tests: result.V02.tests,
    Accuracy:
      (result.V02.accuracy * 100).toFixed(2) + "%",
    Exact:
      (result.V02.exact * 100).toFixed(2) + "%",
    "Goal MAE":
      result.V02.goalMAE.toFixed(4),
    Brier:
      result.V02.brier.toFixed(4)
  },

  V04: {
    Tests: result.V04.tests,
    Accuracy:
      (result.V04.accuracy * 100).toFixed(2) + "%",
    Exact:
      (result.V04.exact * 100).toFixed(2) + "%",
    "Goal MAE":
      result.V04.goalMAE.toFixed(4),
    Brier:
      result.V04.brier.toFixed(4)
  }
};

for (const weight of weights) {

  const weightV02 =
    Math.round(weight * 100);

  const weightV04 =
    Math.round((1 - weight) * 100);

  const key =
    `V02 ${weightV02}% + V04 ${weightV04}%`;

  const data =
    result[`ENSEMBLE_${weight}`];

  output[key] = {
    Tests: data.tests,
    Accuracy:
      (data.accuracy * 100).toFixed(2) + "%",
    Exact:
      (data.exact * 100).toFixed(2) + "%",
    "Goal MAE":
      data.goalMAE.toFixed(4),
    Brier:
      data.brier.toFixed(4)
  };
}

console.table(output);

console.log("");

console.log("Catatan:");
console.log("- Evaluasi READ-ONLY.");
console.log("- Tidak mengubah football.db.");
console.log("- Tidak mengubah production V0.1.");
console.log("- Semua ensemble menggunakan walk-forward evaluation.");
console.log("- Bobot diuji dari 70:30 sampai 30:70.");
console.log("- Bobot pertama = V02, bobot kedua = V04.");

console.log("");
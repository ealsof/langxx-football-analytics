import Database from "better-sqlite3";

const db = new Database("football.db", {
  readonly: true
});

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
V0.2
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

    if (
      m.home_team === homeTeam
    ) {
      home.goalsFor += m.home_score;
      home.goalsAgainst += m.away_score;
      home.matches++;
    }

    if (
      m.away_team === homeTeam
    ) {
      home.goalsFor += m.away_score;
      home.goalsAgainst += m.home_score;
      home.matches++;
    }

    if (
      m.home_team === awayTeam
    ) {
      away.goalsFor += m.home_score;
      away.goalsAgainst += m.away_score;
      away.matches++;
    }

    if (
      m.away_team === awayTeam
    ) {
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
V0.3 RECENT FORM
==================================================
*/

function recentStats(
  team,
  competition,
  previous
) {

  const data =
    previous
      .filter(
        m =>
          m.competition === competition &&
          (
            m.home_team === team ||
            m.away_team === team
          )
      )
      .sort(
        (a, b) =>
          new Date(b.kickoff) -
          new Date(a.kickoff)
      )
      .slice(0, 10);

  let goalsFor = 0;
  let goalsAgainst = 0;
  let weightTotal = 0;

  data.forEach((m, i) => {

    const weight =
      Math.pow(0.85, i);

    if (m.home_team === team) {

      goalsFor +=
        m.home_score * weight;

      goalsAgainst +=
        m.away_score * weight;

    } else {

      goalsFor +=
        m.away_score * weight;

      goalsAgainst +=
        m.home_score * weight;
    }

    weightTotal += weight;
  });

  if (!weightTotal) {
    return null;
  }

  return {
    goalsFor:
      goalsFor / weightTotal,

    goalsAgainst:
      goalsAgainst / weightTotal
  };
}

/*
==================================================
V0.3
==================================================
*/

function predictV03(
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

  const home =
    recentStats(
      homeTeam,
      competition,
      previous
    );

  const away =
    recentStats(
      awayTeam,
      competition,
      previous
    );

  if (!home || !away) {

    return {
      homeGoals: league.homeGoals,
      awayGoals: league.awayGoals,
      homeProb: 0.4118,
      drawProb: 0.2773,
      awayProb: 0.3109
    };
  }

  const homeAttack =
    home.goalsFor /
    Math.max(
      league.homeGoals,
      0.1
    );

  const awayAttack =
    away.goalsFor /
    Math.max(
      league.awayGoals,
      0.1
    );

  const homeDefense =
    home.goalsAgainst /
    Math.max(
      league.awayGoals,
      0.1
    );

  const awayDefense =
    away.goalsAgainst /
    Math.max(
      league.homeGoals,
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

/*
V0.4 menggunakan parameter asli
untuk menjaga eksperimen threshold
tetap terisolasi.

K = 25
Home Advantage = 60
M2 = 1.25
M3 = 1.50
*/

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

    if (
      m.competition !== competition
    ) {
      continue;
    }

    const homeRating =
      getRating(m.home_team);

    const awayRating =
      getRating(m.away_team);

    const expected =
      eloExpected(
        homeRating +
        homeAdvantage,
        awayRating
      );

    let actualScore;

    if (
      m.home_score >
      m.away_score
    ) {

      actualScore = 1;

    } else if (
      m.home_score ===
      m.away_score
    ) {

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

    ratings[m.home_team] +=
      change;

    ratings[m.away_team] -=
      change;
  }

  return ratings;
}

/*
==================================================
V0.4
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
    ratings[homeTeam] ??
    1500;

  const awayRating =
    ratings[awayTeam] ??
    1500;

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
DIXON-COLES
==================================================
*/

function dixonColesTau(
  homeGoals,
  awayGoals,
  lambdaHome,
  lambdaAway,
  rho
) {

  if (
    homeGoals === 0 &&
    awayGoals === 0
  ) {
    return (
      1 -
      lambdaHome *
      lambdaAway *
      rho
    );
  }

  if (
    homeGoals === 0 &&
    awayGoals === 1
  ) {
    return (
      1 +
      lambdaHome * rho
    );
  }

  if (
    homeGoals === 1 &&
    awayGoals === 0
  ) {
    return (
      1 +
      lambdaAway * rho
    );
  }

  if (
    homeGoals === 1 &&
    awayGoals === 1
  ) {
    return 1 - rho;
  }

  return 1;
}

/*
==================================================
V0.5
==================================================
*/

function predictV05(
  homeTeam,
  awayTeam,
  competition,
  previous
) {

  const base =
    predictV03(
      homeTeam,
      awayTeam,
      competition,
      previous
    );

  const rho = -0.10;

  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;

  for (let hg = 0; hg <= 7; hg++) {

    for (let ag = 0; ag <= 7; ag++) {

      const baseProbability =
        poisson(
          base.homeGoals,
          hg
        ) *
        poisson(
          base.awayGoals,
          ag
        );

      const tau =
        dixonColesTau(
          hg,
          ag,
          base.homeGoals,
          base.awayGoals,
          rho
        );

      const probability =
        baseProbability * tau;

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
    homeGoals: base.homeGoals,
    awayGoals: base.awayGoals,

    homeProb:
      homeProb / total,

    drawProb:
      drawProb / total,

    awayProb:
      awayProb / total
  };
}

/*
==================================================
MODELS
==================================================
*/

const models = {
  V02: predictV02,
  V03: predictV03,
  V04: predictV04,
  V05: predictV05
};

/*
==================================================
THRESHOLDS
==================================================
*/

const thresholds = [
  10,
  20,
  30,
  40
];

/*
==================================================
RESULT STORAGE
==================================================
*/

const results = {};

for (const threshold of thresholds) {

  results[threshold] = {};

  for (const modelName of Object.keys(models)) {

    results[threshold][modelName] = {
      tested: 0,
      correct: 0,
      exact: 0,
      goalError: 0,
      brier: 0
    };
  }
}

/*
==================================================
WALK-FORWARD EVALUATION
==================================================
*/

for (
  let i = 0;
  i < matches.length;
  i++
) {

  const match =
    matches[i];

  /*
  CRITICAL:
  Hanya histori sebelum target.
  */

  const previous =
    matches.filter(
      m =>
        m.kickoff <
        match.kickoff
    );

  const competitionHistory =
    previous.filter(
      m =>
        m.competition ===
        match.competition
    );

  const actual =
    actualResult(
      match.home_score,
      match.away_score
    );

  for (
    const threshold
    of thresholds
  ) {

    if (
      competitionHistory.length <
      threshold
    ) {
      continue;
    }

    for (
      const [modelName, model]
      of Object.entries(models)
    ) {

      const prediction =
        model(
          match.home_team,
          match.away_team,
          match.competition,
          previous
        );

      const predicted =
        predictedResult(
          prediction
        );

      const stats =
        results[threshold][modelName];

      if (
        predicted === actual
      ) {
        stats.correct++;
      }

      if (
        Math.round(
          prediction.homeGoals
        ) ===
        match.home_score &&

        Math.round(
          prediction.awayGoals
        ) ===
        match.away_score
      ) {
        stats.exact++;
      }

      stats.goalError +=
        Math.abs(
          prediction.homeGoals -
          match.home_score
        );

      stats.goalError +=
        Math.abs(
          prediction.awayGoals -
          match.away_score
        );

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

      stats.brier +=
        (
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

      stats.tested++;
    }
  }
}

/*
==================================================
OUTPUT
==================================================
*/

console.log("\n==================================================");
console.log(" EVALUATION THRESHOLD SENSITIVITY");
console.log("==================================================\n");

for (const threshold of thresholds) {

  console.log(
    `\n--- Minimum history: ${threshold} ---`
  );

  console.log(
    "Model | Tests | Accuracy | Exact | Goal MAE | Brier"
  );

  console.log(
    "------|-------|----------|-------|----------|------"
  );

  for (
    const modelName
    of Object.keys(models)
  ) {

    const s =
      results[threshold][modelName];

    const accuracy =
      s.correct / s.tested;

    const exact =
      s.exact / s.tested;

    const goalMAE =
      s.goalError /
      (s.tested * 2);

    const brier =
      s.brier /
      s.tested;

    console.log(
      `${modelName.padEnd(5)} | ` +
      `${String(s.tested).padEnd(5)} | ` +
      `${(accuracy * 100).toFixed(2).padStart(8)}% | ` +
      `${(exact * 100).toFixed(2).padStart(5)}% | ` +
      `${goalMAE.toFixed(4).padStart(8)} | ` +
      `${brier.toFixed(4).padStart(6)}`
    );
  }
}

console.log("\n==================================================");
console.log(" READ-ONLY EVALUATION COMPLETE");
console.log(" Database and production model were not changed.");
console.log("==================================================\n");

db.close();
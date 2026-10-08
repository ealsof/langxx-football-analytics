/*
==================================================
ELO HOME ADVANTAGE SENSITIVITY TEST
V0.4 ELO + POISSON
==================================================

Parameter diuji:
40
50
60
70
80
90
100

Parameter lain tetap:
Initial Elo       = 1500
K-factor          = 25
Margin multiplier = 1 / 1.25 / 1.5
Goal factor       = V0.4 asli
Goal cap          = 0.2 - 4.5

Database READ ONLY.
Tidak mengubah football.db.
==================================================
*/

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

function leagueStats(
  competition,
  previous
) {

  const data =
    previous.filter(
      m =>
        m.competition ===
        competition
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

    homeGoals +=
      m.home_score;

    awayGoals +=
      m.away_score;
  }

  return {

    homeGoals:
      homeGoals / data.length,

    awayGoals:
      awayGoals / data.length
  };
}

/*
==================================================
ELO EXPECTED SCORE
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
==================================================
CALCULATE ELO
==================================================
*/

function calculateElo(
  competition,
  previous,
  homeAdvantage
) {

  const ratings = {};

  function getRating(team) {

    if (!(team in ratings)) {
      ratings[team] = 1500;
    }

    return ratings[team];
  }

  /*
  K-factor tetap 25.
  */

  const kFactor = 25;

  for (const m of previous) {

    if (
      m.competition !==
      competition
    ) {
      continue;
    }

    const homeRating =
      getRating(
        m.home_team
      );

    const awayRating =
      getRating(
        m.away_team
      );

    /*
    Home advantage yang sedang
    diuji diterapkan di sini.
    */

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

    /*
    Margin multiplier V0.4 asli.
    */

    const margin =
      Math.abs(
        m.home_score -
        m.away_score
      );

    const multiplier =
      margin <= 1
        ? 1
        : margin === 2
          ? 1.25
          : 1.5;

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
POISSON
==================================================
*/

function poissonPrediction(
  homeGoals,
  awayGoals
) {

  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;

  for (
    let hg = 0;
    hg <= 7;
    hg++
  ) {

    for (
      let ag = 0;
      ag <= 7;
      ag++
    ) {

      const probability =
        poisson(
          homeGoals,
          hg
        ) *
        poisson(
          awayGoals,
          ag
        );

      if (hg > ag) {

        homeProb +=
          probability;

      } else if (
        hg === ag
      ) {

        drawProb +=
          probability;

      } else {

        awayProb +=
          probability;
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
V0.4 PARAMETERIZED
==================================================
*/

function predictV04(
  homeTeam,
  awayTeam,
  competition,
  previous,
  homeAdvantage
) {

  const league =
    leagueStats(
      competition,
      previous
    );

  const ratings =
    calculateElo(
      competition,
      previous,
      homeAdvantage
    );

  const homeRating =
    ratings[homeTeam] ??
    1500;

  const awayRating =
    ratings[awayTeam] ??
    1500;

  /*
  Home advantage juga digunakan
  pada prediksi target, sama seperti
  V0.4 asli.
  */

  const difference =
    homeRating +
    homeAdvantage -
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

/*
==================================================
CONFIGURATIONS
==================================================
*/

const homeAdvantageValues = [
  40,
  50,
  60,
  70,
  80,
  90,
  100
];

const results = {};

for (
  const homeAdvantage
  of homeAdvantageValues
) {

  results[homeAdvantage] = {

    tested: 0,

    correct: 0,

    exact: 0,

    goalError: 0,

    brier: 0
  };
}

/*
==================================================
WALK-FORWARD TEST
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
  Hanya pertandingan
  sebelum target.
  */

  const previous =
    matches.filter(
      m =>
        m.kickoff <
        match.kickoff
    );

  /*
  Minimal 30 pertandingan
  historis kompetisi.
  */

  const competitionHistory =
    previous.filter(
      m =>
        m.competition ===
        match.competition
    );

  if (
    competitionHistory.length <
    30
  ) {
    continue;
  }

  const actual =
    actualResult(
      match.home_score,
      match.away_score
    );

  /*
  Semua nilai home advantage
  diuji pada target yang sama.
  */

  for (
    const homeAdvantage
    of homeAdvantageValues
  ) {

    const prediction =
      predictV04(
        match.home_team,
        match.away_team,
        match.competition,
        previous,
        homeAdvantage
      );

    const predicted =
      predictedResult(
        prediction
      );

    const stats =
      results[homeAdvantage];

    /*
    ACCURACY
    */

    if (
      predicted === actual
    ) {

      stats.correct++;
    }

    /*
    EXACT SCORE
    */

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

    /*
    GOAL ERROR
    */

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

    /*
    BRIER
    */

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

/*
==================================================
OUTPUT
==================================================
*/

console.log("");

console.log(
  "=================================================="
);

console.log(
  " V0.4 ELO HOME ADVANTAGE SENSITIVITY"
);

console.log(
  "=================================================="
);

console.log("");

console.log(
  "HomeAdv | Tests | Accuracy | Exact | Goal MAE | Brier"
);

console.log(
  "--------|-------|----------|-------|----------|------"
);

for (
  const homeAdvantage
  of homeAdvantageValues
) {

  const s =
    results[homeAdvantage];

  const accuracy =
    s.tested
      ? s.correct /
        s.tested
      : 0;

  const exact =
    s.tested
      ? s.exact /
        s.tested
      : 0;

  const goalMAE =
    s.tested
      ? s.goalError /
        (s.tested * 2)
      : 0;

  const brier =
    s.tested
      ? s.brier /
        s.tested
      : 0;

  console.log(
    `${String(homeAdvantage)
      .padEnd(7)} | ` +

    `${String(s.tested)
      .padEnd(5)} | ` +

    `${(accuracy * 100)
      .toFixed(2)
      .padStart(8)}% | ` +

    `${(exact * 100)
      .toFixed(2)
      .padStart(5)}% | ` +

    `${goalMAE
      .toFixed(4)
      .padStart(8)} | ` +

    `${brier
      .toFixed(4)
      .padStart(6)}`
  );
}

console.log("");

console.log(
  "Accuracy / Exact: semakin tinggi semakin baik."
);

console.log(
  "Goal MAE / Brier: semakin rendah semakin baik."
);

console.log(
  "Semua konfigurasi memakai target match yang sama."
);

console.log(
  "Database tidak diubah."
);

console.log("");

db.close();
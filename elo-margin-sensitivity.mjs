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
    homeGoals += m.home_score;
    awayGoals += m.away_score;
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
  marginMultiplier2,
  marginMultiplier3
) {

  const ratings = {};

  function getRating(team) {

    if (!(team in ratings)) {
      ratings[team] = 1500;
    }

    return ratings[team];
  }

  /*
  K-factor tetap.
  */

  const kFactor = 25;

  /*
  Home Advantage kandidat dari
  eksperimen sebelumnya.
  */

  const homeAdvantage = 40;

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
    Margin multiplier.

    0-1 gol  = 1.00
    2 gol    = parameter 1
    >=3 gol  = parameter 2
    */

    const margin =
      Math.abs(
        m.home_score -
        m.away_score
      );

    let multiplier = 1;

    if (margin === 2) {

      multiplier =
        marginMultiplier2;

    } else if (margin >= 3) {

      multiplier =
        marginMultiplier3;
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
  marginMultiplier2,
  marginMultiplier3
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
      marginMultiplier2,
      marginMultiplier3
    );

  const homeRating =
    ratings[homeTeam] ??
    1500;

  const awayRating =
    ratings[awayTeam] ??
    1500;

  /*
  Home Advantage = 40
  */

  const difference =
    homeRating +
    40 -
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
PARAMETER GRID
==================================================
*/

const marginMultiplier2Values = [
  1.00,
  1.10,
  1.20,
  1.25,
  1.30,
  1.40,
  1.50
];

const marginMultiplier3Values = [
  1.00,
  1.20,
  1.40,
  1.50,
  1.60,
  1.80,
  2.00
];

/*
==================================================
RESULT STORAGE
==================================================
*/

const results = [];

for (
  const multiplier2
  of marginMultiplier2Values
) {

  for (
    const multiplier3
    of marginMultiplier3Values
  ) {

    results.push({

      multiplier2,

      multiplier3,

      tested: 0,

      correct: 0,

      exact: 0,

      goalError: 0,

      brier: 0
    });
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
  Hanya gunakan pertandingan
  yang benar-benar terjadi sebelum
  target match.
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

  for (
    const result
    of results
  ) {

    const prediction =
      predictV04(
        match.home_team,
        match.away_team,
        match.competition,
        previous,
        result.multiplier2,
        result.multiplier3
      );

    const predicted =
      predictedResult(
        prediction
      );

    if (
      predicted === actual
    ) {

      result.correct++;
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

      result.exact++;
    }

    result.goalError +=
      Math.abs(
        prediction.homeGoals -
        match.home_score
      );

    result.goalError +=
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

    result.brier +=
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

    result.tested++;
  }
}

/*
==================================================
OUTPUT
==================================================
*/

console.log("");

console.log(
  "=============================================================="
);

console.log(
  " V0.4 ELO MARGIN MULTIPLIER SENSITIVITY"
);

console.log(
  "=============================================================="
);

console.log("");

console.log(
  "M2   | M3   | Tests | Accuracy | Exact | Goal MAE | Brier"
);

console.log(
  "-----|------|-------|----------|-------|----------|------"
);

for (
  const r
  of results
) {

  const accuracy =
    r.correct /
    r.tested;

  const exact =
    r.exact /
    r.tested;

  const goalMAE =
    r.goalError /
    (r.tested * 2);

  const brier =
    r.brier /
    r.tested;

  console.log(

    `${r.multiplier2
      .toFixed(2)
      .padStart(4)} | ` +

    `${r.multiplier3
      .toFixed(2)
      .padStart(4)} | ` +

    `${String(r.tested)
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
  "M2 = multiplier margin kemenangan 2 gol."
);

console.log(
  "M3 = multiplier margin kemenangan >=3 gol."
);

console.log(
  "Accuracy / Exact: semakin tinggi semakin baik."
);

console.log(
  "Goal MAE / Brier: semakin rendah semakin baik."
);

console.log(
  "K-factor = 25."
);

console.log(
  "Home Advantage = 40."
);

console.log(
  "Initial Elo = 1500."
);

console.log(
  "Database tidak diubah."
);

console.log("");

db.close();
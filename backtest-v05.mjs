import Database from "better-sqlite3";

const db = new Database("football.db");

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

/*
========================================
DIXON-COLES LOW SCORE CORRECTION
========================================
*/

function tau(homeGoals, awayGoals, lambdaHome, lambdaAway, rho) {

  if (homeGoals === 0 && awayGoals === 0) {
    return 1 - (lambdaHome * lambdaAway * rho);
  }

  if (homeGoals === 0 && awayGoals === 1) {
    return 1 + (lambdaHome * rho);
  }

  if (homeGoals === 1 && awayGoals === 0) {
    return 1 + (lambdaAway * rho);
  }

  if (homeGoals === 1 && awayGoals === 1) {
    return 1 - rho;
  }

  return 1;
}

/*
========================================
LEAGUE PARAMETERS
========================================
*/

function getLeagueStats(
  competition,
  previous
) {

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

  for (const match of data) {

    homeGoals += match.home_score;
    awayGoals += match.away_score;
  }

  return {
    homeGoals: homeGoals / data.length,
    awayGoals: awayGoals / data.length
  };
}

/*
========================================
TEAM STRENGTH
========================================

Menggunakan weighted historical data.

Pertandingan terbaru diberi bobot lebih besar.
*/

function getTeamStrength(
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
      .slice(0, 15);

  if (!data.length) {
    return null;
  }

  let attack = 0;
  let defense = 0;
  let weightTotal = 0;

  for (let i = 0; i < data.length; i++) {

    const match = data[i];

    /*
    Time decay.
    Match terbaru = bobot terbesar.
    */

    const weight =
      Math.pow(0.90, i);

    let goalsFor;
    let goalsAgainst;

    if (match.home_team === team) {

      goalsFor =
        match.home_score;

      goalsAgainst =
        match.away_score;

    } else {

      goalsFor =
        match.away_score;

      goalsAgainst =
        match.home_score;
    }

    attack +=
      goalsFor * weight;

    defense +=
      goalsAgainst * weight;

    weightTotal += weight;
  }

  return {
    attack:
      attack / weightTotal,

    defense:
      defense / weightTotal,

    matches:
      data.length
  };
}

/*
========================================
DIXON-COLES PREDICTION
========================================
*/

function predictDixonColes(
  homeTeam,
  awayTeam,
  competition,
  previous
) {

  const league =
    getLeagueStats(
      competition,
      previous
    );

  const home =
    getTeamStrength(
      homeTeam,
      competition,
      previous
    );

  const away =
    getTeamStrength(
      awayTeam,
      competition,
      previous
    );

  /*
  Belum cukup data.
  Gunakan league baseline.
  */

  if (!home || !away) {

    return {
      homeGoals:
        league.homeGoals,

      awayGoals:
        league.awayGoals,

      homeProb: 0.4118,
      drawProb: 0.2773,
      awayProb: 0.3109
    };
  }

  /*
  Attack strength.
  */

  const homeAttack =
    home.attack /
    Math.max(
      league.homeGoals,
      0.1
    );

  const awayAttack =
    away.attack /
    Math.max(
      league.awayGoals,
      0.1
    );

  /*
  Defensive strength.
  */

  const homeDefense =
    home.defense /
    Math.max(
      league.awayGoals,
      0.1
    );

  const awayDefense =
    away.defense /
    Math.max(
      league.homeGoals,
      0.1
    );

  /*
  Expected goals.
  */

  let lambdaHome =
    league.homeGoals *
    homeAttack *
    awayDefense;

  let lambdaAway =
    league.awayGoals *
    awayAttack *
    homeDefense;

  /*
  Home advantage.
  */

  lambdaHome *= 1.05;

  /*
  Prevent extreme values.
  */

  lambdaHome =
    Math.max(
      0.20,
      Math.min(
        lambdaHome,
        4.50
      )
    );

  lambdaAway =
    Math.max(
      0.20,
      Math.min(
        lambdaAway,
        4.50
      )
    );

  /*
  Dixon-Coles rho.

  Negative rho memberikan koreksi
  pada hasil skor rendah.
  */

  const rho = -0.10;

  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;

  /*
  Score matrix.
  */

  for (let hg = 0; hg <= 7; hg++) {

    for (let ag = 0; ag <= 7; ag++) {

      let probability =
        poisson(
          lambdaHome,
          hg
        ) *
        poisson(
          lambdaAway,
          ag
        );

      /*
      Dixon-Coles correction.
      */

      probability *=
        tau(
          hg,
          ag,
          lambdaHome,
          lambdaAway,
          rho
        );

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

    homeGoals:
      lambdaHome,

    awayGoals:
      lambdaAway,

    homeProb:
      homeProb / total,

    drawProb:
      drawProb / total,

    awayProb:
      awayProb / total
  };
}

/*
========================================
PREDICTED RESULT
========================================
*/

function predictedResult(prediction) {

  const values = [

    ["H", prediction.homeProb],

    ["D", prediction.drawProb],

    ["A", prediction.awayProb]

  ];

  values.sort(
    (a, b) => b[1] - a[1]
  );

  return values[0][0];
}

/*
========================================
BACKTEST
========================================
*/

let tested = 0;
let correct = 0;
let exact = 0;

let goalError = 0;
let brier = 0;

for (const match of matches) {

  /*
  CRITICAL:

  Hanya gunakan pertandingan
  yang terjadi SEBELUM match target.
  */

  const previous =
    matches.filter(
      m =>
        new Date(m.kickoff) <
        new Date(match.kickoff)
    );

  /*
  Minimal history.
  */

  if (previous.length < 20) {
    continue;
  }

  const prediction =
    predictDixonColes(
      match.home_team,
      match.away_team,
      match.competition,
      previous
    );

  const actual =
    actualResult(
      match.home_score,
      match.away_score
    );

  const predicted =
    predictedResult(
      prediction
    );

  /*
  1X2
  */

  if (predicted === actual) {
    correct++;
  }

  /*
  Exact score.
  */

  if (
    Math.round(
      prediction.homeGoals
    ) === match.home_score &&
    Math.round(
      prediction.awayGoals
    ) === match.away_score
  ) {
    exact++;
  }

  /*
  Goal MAE.
  */

  goalError +=
    Math.abs(
      prediction.homeGoals -
      match.home_score
    );

  goalError +=
    Math.abs(
      prediction.awayGoals -
      match.away_score
    );

  /*
  Brier score.
  */

  brier +=
    Math.pow(
      prediction.homeProb -
      (actual === "H" ? 1 : 0),
      2
    );

  brier +=
    Math.pow(
      prediction.drawProb -
      (actual === "D" ? 1 : 0),
      2
    );

  brier +=
    Math.pow(
      prediction.awayProb -
      (actual === "A" ? 1 : 0),
      2
    );

  tested++;
}

/*
========================================
RESULT
========================================
*/

const accuracy =
  tested > 0
    ? correct / tested
    : 0;

const exactRate =
  tested > 0
    ? exact / tested
    : 0;

const goalMAE =
  tested > 0
    ? goalError /
      (tested * 2)
    : 0;

const brierScore =
  tested > 0
    ? brier / tested
    : 0;

console.log("");

console.log(
  "=============================================="
);

console.log(
  " FOOTBALL ANALYTICS LAB"
);

console.log(
  " V0.5 DIXON-COLES BACKTEST"
);

console.log(
  "=============================================="
);

console.log("");

console.log(
  `Matches tested : ${tested}`
);

console.log(
  `1X2 accuracy   : ${(accuracy * 100).toFixed(2)}%`
);

console.log(
  `Exact score    : ${(exactRate * 100).toFixed(2)}%`
);

console.log(
  `Goal MAE       : ${goalMAE.toFixed(3)}`
);

console.log(
  `Brier score    : ${brierScore.toFixed(4)}`
);

console.log("");

console.log(
  "=============================================="
);

db.close();
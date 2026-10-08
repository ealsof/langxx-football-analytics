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
  ORDER BY kickoff ASC;
`).all();

function poisson(lambda, k) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function getTeamStats(team, previousMatches) {

  const homeMatches = previousMatches.filter(
    m => m.home_team === team
  );

  const awayMatches = previousMatches.filter(
    m => m.away_team === team
  );

  const allMatches = [...homeMatches, ...awayMatches];

  if (allMatches.length === 0) {
    return null;
  }

  const goalsFor = allMatches.reduce((sum, m) => {
    if (m.home_team === team) {
      return sum + m.home_score;
    }

    return sum + m.away_score;
  }, 0);

  const goalsAgainst = allMatches.reduce((sum, m) => {
    if (m.home_team === team) {
      return sum + m.away_score;
    }

    return sum + m.home_score;
  }, 0);

  const homeGoalsFor = homeMatches.reduce(
    (sum, m) => sum + m.home_score,
    0
  );

  const homeGoalsAgainst = homeMatches.reduce(
    (sum, m) => sum + m.away_score,
    0
  );

  const awayGoalsFor = awayMatches.reduce(
    (sum, m) => sum + m.away_score,
    0
  );

  const awayGoalsAgainst = awayMatches.reduce(
    (sum, m) => sum + m.home_score,
    0
  );

  return {
    matches: allMatches.length,

    goalsForPerMatch:
      goalsFor / allMatches.length,

    goalsAgainstPerMatch:
      goalsAgainst / allMatches.length,

    homeMatches: homeMatches.length,

    homeGoalsForPerMatch:
      homeMatches.length > 0
        ? homeGoalsFor / homeMatches.length
        : null,

    homeGoalsAgainstPerMatch:
      homeMatches.length > 0
        ? homeGoalsAgainst / homeMatches.length
        : null,

    awayMatches: awayMatches.length,

    awayGoalsForPerMatch:
      awayMatches.length > 0
        ? awayGoalsFor / awayMatches.length
        : null,

    awayGoalsAgainstPerMatch:
      awayMatches.length > 0
        ? awayGoalsAgainst / awayMatches.length
        : null
  };
}

function getLeagueStats(competition, previousMatches) {

  const leagueMatches = previousMatches.filter(
    m => m.competition === competition
  );

  if (leagueMatches.length === 0) {
    return {
      homeGoals: 1.5,
      awayGoals: 1.2
    };
  }

  const homeGoals = leagueMatches.reduce(
    (sum, m) => sum + m.home_score,
    0
  );

  const awayGoals = leagueMatches.reduce(
    (sum, m) => sum + m.away_score,
    0
  );

  return {
    homeGoals: homeGoals / leagueMatches.length,
    awayGoals: awayGoals / leagueMatches.length
  };
}

function predict(homeTeam, awayTeam, competition, previousMatches) {

  const homeStats = getTeamStats(
    homeTeam,
    previousMatches
  );

  const awayStats = getTeamStats(
    awayTeam,
    previousMatches
  );

  const leagueStats = getLeagueStats(
    competition,
    previousMatches
  );

  /*
    Kalau belum ada data historis untuk salah satu tim,
    gunakan league average sebagai fallback.
  */

  if (!homeStats || !awayStats) {
    return {
      homeProb: 0.4118,
      drawProb: 0.2773,
      awayProb: 0.3109,
      homeGoals: leagueStats.homeGoals,
      awayGoals: leagueStats.awayGoals
    };
  }

  /*
    Attack strength:
    seberapa produktif tim mencetak gol.

    Defense strength:
    seberapa banyak lawan mencetak gol
    ketika menghadapi tim tersebut.
  */

  const homeAttack =
    homeStats.goalsForPerMatch /
    Math.max(leagueStats.homeGoals, 0.1);

  const awayAttack =
    awayStats.goalsForPerMatch /
    Math.max(leagueStats.awayGoals, 0.1);

  const homeDefense =
    homeStats.goalsAgainstPerMatch /
    Math.max(leagueStats.awayGoals, 0.1);

  const awayDefense =
    awayStats.goalsAgainstPerMatch /
    Math.max(leagueStats.homeGoals, 0.1);

  /*
    Expected goals.

    Kita kombinasikan kekuatan menyerang tim
    dengan kelemahan bertahan lawan.
  */

  let expectedHomeGoals =
    leagueStats.homeGoals *
    homeAttack *
    awayDefense;

  let expectedAwayGoals =
    leagueStats.awayGoals *
    awayAttack *
    homeDefense;

  /*
    Home advantage tambahan kecil.
  */

  expectedHomeGoals *= 1.05;

  /*
    Batasi nilai agar model tidak menghasilkan
    expected goals yang ekstrem.
  */

  expectedHomeGoals = Math.max(
    0.2,
    Math.min(expectedHomeGoals, 4.5)
  );

  expectedAwayGoals = Math.max(
    0.2,
    Math.min(expectedAwayGoals, 4.5)
  );

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  /*
    Hitung probabilitas seluruh skor 0-0
    sampai 7-7.
  */

  for (let homeGoals = 0; homeGoals <= 7; homeGoals++) {

    for (let awayGoals = 0; awayGoals <= 7; awayGoals++) {

      const probability =
        poisson(expectedHomeGoals, homeGoals) *
        poisson(expectedAwayGoals, awayGoals);

      if (homeGoals > awayGoals) {
        homeWin += probability;
      }
      else if (homeGoals === awayGoals) {
        draw += probability;
      }
      else {
        awayWin += probability;
      }
    }
  }

  const total =
    homeWin +
    draw +
    awayWin;

  homeWin /= total;
  draw /= total;
  awayWin /= total;

  return {
    homeProb: homeWin,
    drawProb: draw,
    awayProb: awayWin,
    homeGoals: expectedHomeGoals,
    awayGoals: expectedAwayGoals
  };
}

function getResult(homeScore, awayScore) {

  if (homeScore > awayScore) {
    return "H";
  }

  if (homeScore === awayScore) {
    return "D";
  }

  return "A";
}

function getPredictedResult(prediction) {

  const values = [
    {
      result: "H",
      probability: prediction.homeProb
    },
    {
      result: "D",
      probability: prediction.drawProb
    },
    {
      result: "A",
      probability: prediction.awayProb
    }
  ];

  values.sort(
    (a, b) => b.probability - a.probability
  );

  return values[0].result;
}

let tested = 0;
let correct = 0;

let exactScore = 0;

let totalGoalError = 0;

let brierTotal = 0;

console.log("");
console.log("====================================");
console.log(" FOOTBALL ANALYTICS LAB - BACKTEST");
console.log(" MODEL: V0.2 TEAM STRENGTH");
console.log("====================================");

for (const match of matches) {

  /*
    STRICT TEMPORAL CUTOFF.

    Hanya pertandingan dengan kickoff
    SEBELUM pertandingan target yang boleh
    digunakan sebagai informasi.
  */

  const previousMatches = matches.filter(
    previous =>
      previous.kickoff < match.kickoff
  );

  /*
    Minimal data historis.

    Kita tidak memaksa model memprediksi
    pertandingan ketika belum ada basis data.
  */

  if (previousMatches.length < 20) {
    continue;
  }

  const prediction = predict(
    match.home_team,
    match.away_team,
    match.competition,
    previousMatches
  );

  const actualResult = getResult(
    match.home_score,
    match.away_score
  );

  const predictedResult =
    getPredictedResult(prediction);

  if (predictedResult === actualResult) {
    correct++;
  }

  const predictedHomeScore =
    Math.round(prediction.homeGoals);

  const predictedAwayScore =
    Math.round(prediction.awayGoals);

  if (
    predictedHomeScore === match.home_score &&
    predictedAwayScore === match.away_score
  ) {
    exactScore++;
  }

  totalGoalError +=
    Math.abs(
      prediction.homeGoals - match.home_score
    );

  totalGoalError +=
    Math.abs(
      prediction.awayGoals - match.away_score
    );

  brierTotal +=
    Math.pow(
      prediction.homeProb -
      (actualResult === "H" ? 1 : 0),
      2
    );

  brierTotal +=
    Math.pow(
      prediction.drawProb -
      (actualResult === "D" ? 1 : 0),
      2
    );

  brierTotal +=
    Math.pow(
      prediction.awayProb -
      (actualResult === "A" ? 1 : 0),
      2
    );

  tested++;
}

const accuracy =
  tested > 0
    ? correct / tested
    : 0;

const exactRate =
  tested > 0
    ? exactScore / tested
    : 0;

const goalMAE =
  tested > 0
    ? totalGoalError / (tested * 2)
    : 0;

const brier =
  tested > 0
    ? brierTotal / tested
    : 0;

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
  `Brier score    : ${brier.toFixed(4)}`
);

console.log("");

console.log("====================================");

db.close();
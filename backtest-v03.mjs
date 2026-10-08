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

function getLeagueStats(competition, previousMatches) {

  const leagueMatches = previousMatches.filter(
    m => m.competition === competition
  );

  if (leagueMatches.length === 0) {
    return {
      homeGoals: 1.45,
      awayGoals: 1.15
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
    homeGoals:
      homeGoals / leagueMatches.length,

    awayGoals:
      awayGoals / leagueMatches.length
  };
}

function getTeamMatches(
  team,
  competition,
  previousMatches
) {

  return previousMatches
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
    );
}

function getWeightedStats(
  team,
  competition,
  previousMatches
) {

  const teamMatches =
    getTeamMatches(
      team,
      competition,
      previousMatches
    );

  /*
    Kita hanya menggunakan 10 pertandingan
    terakhir sebelum target.
  */

  const recentMatches =
    teamMatches.slice(0, 10);

  if (recentMatches.length === 0) {
    return null;
  }

  let weightedGoalsFor = 0;
  let weightedGoalsAgainst = 0;

  let weightedPoints = 0;

  let totalWeight = 0;

  let homeWeightedGoalsFor = 0;
  let homeWeightedGoalsAgainst = 0;
  let homeWeight = 0;

  let awayWeightedGoalsFor = 0;
  let awayWeightedGoalsAgainst = 0;
  let awayWeight = 0;

  for (let i = 0; i < recentMatches.length; i++) {

    const match = recentMatches[i];

    /*
      Recency weighting.

      Match terbaru = bobot terbesar.
    */

    const weight =
      Math.pow(0.85, i);

    let goalsFor;
    let goalsAgainst;
    let points;

    if (match.home_team === team) {

      goalsFor = match.home_score;
      goalsAgainst = match.away_score;

      if (goalsFor > goalsAgainst) {
        points = 3;
      }
      else if (goalsFor === goalsAgainst) {
        points = 1;
      }
      else {
        points = 0;
      }

      homeWeightedGoalsFor +=
        goalsFor * weight;

      homeWeightedGoalsAgainst +=
        goalsAgainst * weight;

      homeWeight += weight;

    }
    else {

      goalsFor = match.away_score;
      goalsAgainst = match.home_score;

      if (goalsFor > goalsAgainst) {
        points = 3;
      }
      else if (goalsFor === goalsAgainst) {
        points = 1;
      }
      else {
        points = 0;
      }

      awayWeightedGoalsFor +=
        goalsFor * weight;

      awayWeightedGoalsAgainst +=
        goalsAgainst * weight;

      awayWeight += weight;
    }

    weightedGoalsFor +=
      goalsFor * weight;

    weightedGoalsAgainst +=
      goalsAgainst * weight;

    weightedPoints +=
      points * weight;

    totalWeight += weight;
  }

  return {

    matches:
      recentMatches.length,

    goalsFor:
      weightedGoalsFor /
      totalWeight,

    goalsAgainst:
      weightedGoalsAgainst /
      totalWeight,

    pointsPerMatch:
      weightedPoints /
      totalWeight,

    homeGoalsFor:
      homeWeight > 0
        ? homeWeightedGoalsFor / homeWeight
        : null,

    homeGoalsAgainst:
      homeWeight > 0
        ? homeWeightedGoalsAgainst / homeWeight
        : null,

    awayGoalsFor:
      awayWeight > 0
        ? awayWeightedGoalsFor / awayWeight
        : null,

    awayGoalsAgainst:
      awayWeight > 0
        ? awayWeightedGoalsAgainst / awayWeight
        : null
  };
}

function predict(
  homeTeam,
  awayTeam,
  competition,
  previousMatches
) {

  const league =
    getLeagueStats(
      competition,
      previousMatches
    );

  const home =
    getWeightedStats(
      homeTeam,
      competition,
      previousMatches
    );

  const away =
    getWeightedStats(
      awayTeam,
      competition,
      previousMatches
    );

  /*
    Belum punya cukup informasi.
    Gunakan league average.
  */

  if (!home || !away) {

    return {
      homeGoals: league.homeGoals,
      awayGoals: league.awayGoals,
      homeProb: 0.4118,
      drawProb: 0.2773,
      awayProb: 0.3109
    };
  }

  /*
    Attack strength.

    Dibandingkan dengan rata-rata liga.
  */

  const homeAttack =
    home.homeGoalsFor ??
    home.goalsFor;

  const awayAttack =
    away.awayGoalsFor ??
    away.goalsFor;

  const homeDefense =
    home.homeGoalsAgainst ??
    home.goalsAgainst;

  const awayDefense =
    away.awayGoalsAgainst ??
    away.goalsAgainst;

  /*
    Normalisasi terhadap rata-rata liga.
  */

  const homeAttackFactor =
    homeAttack /
    Math.max(league.homeGoals, 0.1);

  const awayAttackFactor =
    awayAttack /
    Math.max(league.awayGoals, 0.1);

  const homeDefenseFactor =
    homeDefense /
    Math.max(league.awayGoals, 0.1);

  const awayDefenseFactor =
    awayDefense /
    Math.max(league.homeGoals, 0.1);

  /*
    Expected goals.
  */

  let expectedHomeGoals =
    league.homeGoals *
    homeAttackFactor *
    awayDefenseFactor;

  let expectedAwayGoals =
    league.awayGoals *
    awayAttackFactor *
    homeDefenseFactor;

  /*
    Home advantage.
  */

  expectedHomeGoals *= 1.05;

  /*
    Form adjustment kecil.

    PPM dibandingkan dengan baseline 1.5.
  */

  const homeFormFactor =
    1 +
    ((home.pointsPerMatch - 1.5) * 0.05);

  const awayFormFactor =
    1 +
    ((away.pointsPerMatch - 1.5) * 0.05);

  expectedHomeGoals *= homeFormFactor;
  expectedAwayGoals *= awayFormFactor;

  /*
    Hindari nilai ekstrem.
  */

  expectedHomeGoals =
    Math.max(
      0.2,
      Math.min(expectedHomeGoals, 4.5)
    );

  expectedAwayGoals =
    Math.max(
      0.2,
      Math.min(expectedAwayGoals, 4.5)
    );

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  /*
    Distribusi skor 0-7.
  */

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
          expectedHomeGoals,
          hg
        ) *
        poisson(
          expectedAwayGoals,
          ag
        );

      if (hg > ag) {
        homeWin += probability;
      }
      else if (hg === ag) {
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
    homeGoals: expectedHomeGoals,
    awayGoals: expectedAwayGoals,
    homeProb: homeWin,
    drawProb: draw,
    awayProb: awayWin
  };
}

function getActualResult(
  homeScore,
  awayScore
) {

  if (homeScore > awayScore) {
    return "H";
  }

  if (homeScore === awayScore) {
    return "D";
  }

  return "A";
}

function getPredictedResult(
  prediction
) {

  const results = [
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

  results.sort(
    (a, b) =>
      b.probability -
      a.probability
  );

  return results[0].result;
}

let tested = 0;
let correct = 0;
let exactScore = 0;

let totalGoalError = 0;
let brierTotal = 0;

console.log("");
console.log("====================================");
console.log(" FOOTBALL ANALYTICS LAB - BACKTEST");
console.log(" MODEL: V0.3 RECENT FORM");
console.log("====================================");

for (const match of matches) {

  /*
    ANTI DATA LEAKAGE.

    Hanya pertandingan sebelum target.
  */

  const previousMatches =
    matches.filter(
      previous =>
        previous.kickoff <
        match.kickoff
    );

  /*
    Minimal 20 pertandingan historis.
  */

  if (previousMatches.length < 20) {
    continue;
  }

  const prediction =
    predict(
      match.home_team,
      match.away_team,
      match.competition,
      previousMatches
    );

  const actualResult =
    getActualResult(
      match.home_score,
      match.away_score
    );

  const predictedResult =
    getPredictedResult(
      prediction
    );

  if (
    predictedResult ===
    actualResult
  ) {
    correct++;
  }

  const roundedHome =
    Math.round(
      prediction.homeGoals
    );

  const roundedAway =
    Math.round(
      prediction.awayGoals
    );

  if (
    roundedHome ===
      match.home_score &&
    roundedAway ===
      match.away_score
  ) {
    exactScore++;
  }

  totalGoalError +=
    Math.abs(
      prediction.homeGoals -
      match.home_score
    );

  totalGoalError +=
    Math.abs(
      prediction.awayGoals -
      match.away_score
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
    ? totalGoalError /
      (tested * 2)
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
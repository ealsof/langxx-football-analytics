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

const INITIAL_ELO = 1500;
const HOME_ADVANTAGE = 60;
const K_FACTOR = 25;

function getResult(homeScore, awayScore) {
  if (homeScore > awayScore) return "H";
  if (homeScore === awayScore) return "D";
  return "A";
}

function expectedScore(ratingA, ratingB) {
  return 1 / (
    1 +
    Math.pow(10, (ratingB - ratingA) / 400)
  );
}

function getActualScore(result) {
  if (result === "H") return 1;
  if (result === "D") return 0.5;
  return 0;
}

function poisson(lambda, k) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial(k)
  );
}

function factorial(n) {
  if (n <= 1) return 1;

  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function getLeagueStats(
  competition,
  previousMatches
) {

  const leagueMatches =
    previousMatches.filter(
      m => m.competition === competition
    );

  if (leagueMatches.length === 0) {
    return {
      homeGoals: 1.45,
      awayGoals: 1.15
    };
  }

  const homeGoals =
    leagueMatches.reduce(
      (sum, m) => sum + m.home_score,
      0
    );

  const awayGoals =
    leagueMatches.reduce(
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

function calculateElo(
  competition,
  previousMatches
) {

  const ratings = {};

  const getRating = team => {
    if (!(team in ratings)) {
      ratings[team] = INITIAL_ELO;
    }

    return ratings[team];
  };

  for (const match of previousMatches) {

    if (match.competition !== competition) {
      continue;
    }

    const homeRating =
      getRating(match.home_team);

    const awayRating =
      getRating(match.away_team);

    const expectedHome =
      expectedScore(
        homeRating + HOME_ADVANTAGE,
        awayRating
      );

    const actualHome =
      getActualScore(
        getResult(
          match.home_score,
          match.away_score
        )
      );

    const goalDifference =
      Math.abs(
        match.home_score -
        match.away_score
      );

    /*
      Margin of victory multiplier.

      Kemenangan dengan selisih besar
      memberi update rating sedikit lebih besar.
    */

    const marginMultiplier =
      goalDifference <= 1
        ? 1
        : goalDifference === 2
          ? 1.25
          : 1.5;

    const update =
      K_FACTOR *
      marginMultiplier *
      (actualHome - expectedHome);

    ratings[match.home_team] =
      homeRating + update;

    ratings[match.away_team] =
      awayRating - update;
  }

  return ratings;
}

function getStrengthFactor(
  homeRating,
  awayRating
) {

  const difference =
    (homeRating + HOME_ADVANTAGE) -
    awayRating;

  /*
    Mengubah selisih Elo menjadi
    faktor expected goals.

    Faktor dibatasi supaya tidak ekstrem.
  */

  const factor =
    1 +
    difference / 1000;

  return Math.max(
    0.65,
    Math.min(factor, 1.35)
  );
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

  const ratings =
    calculateElo(
      competition,
      previousMatches
    );

  const homeRating =
    ratings[homeTeam] ??
    INITIAL_ELO;

  const awayRating =
    ratings[awayTeam] ??
    INITIAL_ELO;

  const homeDifference =
    (homeRating + HOME_ADVANTAGE) -
    awayRating;

  /*
    Expected goals dasar.
  */

  let expectedHomeGoals =
    league.homeGoals;

  let expectedAwayGoals =
    league.awayGoals;

  /*
    Elo digunakan sebagai pengubah
    kekuatan relatif.

    Kita tidak mengubah kedua tim
    dengan faktor yang sama.
  */

  const homeFactor =
    Math.max(
      0.65,
      Math.min(
        1.35,
        1 + homeDifference / 1000
      )
    );

  const awayFactor =
    Math.max(
      0.65,
      Math.min(
        1.35,
        1 - homeDifference / 1200
      )
    );

  expectedHomeGoals *=
    homeFactor;

  expectedAwayGoals *=
    awayFactor;

  /*
    Batas keamanan.
  */

  expectedHomeGoals =
    Math.max(
      0.2,
      Math.min(
        expectedHomeGoals,
        4.5
      )
    );

  expectedAwayGoals =
    Math.max(
      0.2,
      Math.min(
        expectedAwayGoals,
        4.5
      )
    );

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

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

function getPredictedResult(
  prediction
) {

  const results = [
    {
      result: "H",
      probability:
        prediction.homeProb
    },
    {
      result: "D",
      probability:
        prediction.drawProb
    },
    {
      result: "A",
      probability:
        prediction.awayProb
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
console.log(" MODEL: V0.4 ELO + POISSON");
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
    getResult(
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

  const predictedHome =
    Math.round(
      prediction.homeGoals
    );

  const predictedAway =
    Math.round(
      prediction.awayGoals
    );

  if (
    predictedHome ===
      match.home_score &&
    predictedAway ===
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

  /*
    Brier score.

    Tetap menggunakan definisi yang sama
    dengan V0.1 - V0.3 agar perbandingan
    konsisten.
  */

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
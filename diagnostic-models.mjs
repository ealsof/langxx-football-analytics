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

function actualResult(home, away) {
  if (home > away) return "H";
  if (home === away) return "D";
  return "A";
}

function predictedResult(p) {

  const values = [
    ["H", p.homeProb],
    ["D", p.drawProb],
    ["A", p.awayProb]
  ];

  values.sort((a, b) => b[1] - a[1]);

  return values[0][0];
}

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

  return {
    homeGoals:
      data.reduce(
        (sum, m) => sum + m.home_score,
        0
      ) / data.length,

    awayGoals:
      data.reduce(
        (sum, m) => sum + m.away_score,
        0
      ) / data.length
  };
}

/* ================================
   V0.1
================================ */

function predictV01() {

  return {
    homeProb: 0.45,
    drawProb: 0.27,
    awayProb: 0.28,
    homeGoals: 1.55,
    awayGoals: 1.05
  };
}

/* ================================
   V0.2
================================ */

function teamStats(
  team,
  competition,
  previous
) {

  const data = previous.filter(
    m =>
      m.competition === competition &&
      (
        m.home_team === team ||
        m.away_team === team
      )
  );

  if (!data.length) {
    return null;
  }

  let gf = 0;
  let ga = 0;

  for (const m of data) {

    if (m.home_team === team) {
      gf += m.home_score;
      ga += m.away_score;
    }
    else {
      gf += m.away_score;
      ga += m.home_score;
    }
  }

  return {
    matches: data.length,
    goalsFor: gf / data.length,
    goalsAgainst: ga / data.length
  };
}

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

  const home =
    teamStats(
      homeTeam,
      competition,
      previous
    );

  const away =
    teamStats(
      awayTeam,
      competition,
      previous
    );

  if (!home || !away) {
    return {
      homeProb: 0.4118,
      drawProb: 0.2773,
      awayProb: 0.3109,
      homeGoals: league.homeGoals,
      awayGoals: league.awayGoals
    };
  }

  const homeAttack =
    home.goalsFor /
    Math.max(league.homeGoals, 0.1);

  const awayAttack =
    away.goalsFor /
    Math.max(league.awayGoals, 0.1);

  const homeDefense =
    home.goalsAgainst /
    Math.max(league.awayGoals, 0.1);

  const awayDefense =
    away.goalsAgainst /
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

/* ================================
   V0.3
================================ */

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

  if (!data.length) {
    return null;
  }

  let gf = 0;
  let ga = 0;
  let totalWeight = 0;

  for (let i = 0; i < data.length; i++) {

    const m = data[i];

    const weight =
      Math.pow(0.85, i);

    if (m.home_team === team) {
      gf += m.home_score * weight;
      ga += m.away_score * weight;
    }
    else {
      gf += m.away_score * weight;
      ga += m.home_score * weight;
    }

    totalWeight += weight;
  }

  return {
    goalsFor:
      gf / totalWeight,

    goalsAgainst:
      ga / totalWeight
  };
}

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
      homeProb: 0.4118,
      drawProb: 0.2773,
      awayProb: 0.3109,
      homeGoals: league.homeGoals,
      awayGoals: league.awayGoals
    };
  }

  const homeAttack =
    home.goalsFor /
    Math.max(league.homeGoals, 0.1);

  const awayAttack =
    away.goalsFor /
    Math.max(league.awayGoals, 0.1);

  const homeDefense =
    home.goalsAgainst /
    Math.max(league.awayGoals, 0.1);

  const awayDefense =
    away.goalsAgainst /
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

/* ================================
   V0.4
================================ */

function expectedScore(
  ratingA,
  ratingB
) {

  return 1 / (
    1 +
    Math.pow(
      10,
      (ratingB - ratingA) / 400
    )
  );
}

function actualEloScore(result) {

  if (result === "H") return 1;
  if (result === "D") return 0.5;

  return 0;
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

  for (const m of previous) {

    if (m.competition !== competition) {
      continue;
    }

    const homeRating =
      getRating(m.home_team);

    const awayRating =
      getRating(m.away_team);

    const expectedHome =
      expectedScore(
        homeRating + 60,
        awayRating
      );

    const result =
      actualResult(
        m.home_score,
        m.away_score
      );

    const actualHome =
      actualEloScore(result);

    const difference =
      Math.abs(
        m.home_score -
        m.away_score
      );

    const multiplier =
      difference <= 1
        ? 1
        : difference === 2
          ? 1.25
          : 1.5;

    const update =
      25 *
      multiplier *
      (actualHome - expectedHome);

    ratings[m.home_team] =
      homeRating + update;

    ratings[m.away_team] =
      awayRating - update;
  }

  return ratings;
}

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
    (homeRating + 60) -
    awayRating;

  const homeFactor =
    Math.max(
      0.65,
      Math.min(
        1.35,
        1 + difference / 1000
      )
    );

  const awayFactor =
    Math.max(
      0.65,
      Math.min(
        1.35,
        1 - difference / 1200
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

/* ================================
   POISSON
================================ */

function poissonPrediction(
  homeGoals,
  awayGoals
) {

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
      }
      else if (hg === ag) {
        drawProb += probability;
      }
      else {
        awayProb += probability;
      }
    }
  }

  const total =
    homeProb +
    drawProb +
    awayProb;

  return {
    homeProb:
      homeProb / total,

    drawProb:
      drawProb / total,

    awayProb:
      awayProb / total,

    homeGoals,
    awayGoals
  };
}

/* ================================
   EVALUATION
================================ */

function createStats() {

  return {
    tested: 0,
    correct: 0,
    exact: 0,
    goalError: 0,
    brier: 0
  };
}

const results = {};

for (const competition of [
  "Premier League",
  "La Liga"
]) {

  results[competition] = {
    V01: createStats(),
    V02: createStats(),
    V03: createStats(),
    V04: createStats()
  };
}

for (const match of matches) {

  const previous =
    matches.filter(
      m =>
        m.kickoff <
        match.kickoff
    );

  if (previous.length < 20) {
    continue;
  }

  const competition =
    match.competition;

  if (!results[competition]) {
    continue;
  }

  const models = {

    V01: predictV01(),

    V02: predictV02(
      match.home_team,
      match.away_team,
      competition,
      previous
    ),

    V03: predictV03(
      match.home_team,
      match.away_team,
      competition,
      previous
    ),

    V04: predictV04(
      match.home_team,
      match.away_team,
      competition,
      previous
    )
  };

  const actual =
    actualResult(
      match.home_score,
      match.away_score
    );

  for (const [name, prediction] of
    Object.entries(models)) {

    const stats =
      results[competition][name];

    const predicted =
      predictedResult(prediction);

    if (predicted === actual) {
      stats.correct++;
    }

    if (
      Math.round(prediction.homeGoals) ===
        match.home_score &&
      Math.round(prediction.awayGoals) ===
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

    stats.brier +=
      Math.pow(
        prediction.homeProb -
        (actual === "H" ? 1 : 0),
        2
      );

    stats.brier +=
      Math.pow(
        prediction.drawProb -
        (actual === "D" ? 1 : 0),
        2
      );

    stats.brier +=
      Math.pow(
        prediction.awayProb -
        (actual === "A" ? 1 : 0),
        2
      );

    stats.tested++;
  }
}

/* ================================
   OUTPUT
================================ */

console.log("");
console.log("==============================================");
console.log(" FOOTBALL ANALYTICS LAB");
console.log(" MODEL DIAGNOSTIC");
console.log("==============================================");

for (const competition of
  Object.keys(results)) {

  console.log("");
  console.log("----------------------------------------------");
  console.log(competition);
  console.log("----------------------------------------------");

  for (const [model, stats] of
    Object.entries(results[competition])) {

    const accuracy =
      stats.tested > 0
        ? stats.correct / stats.tested
        : 0;

    const exact =
      stats.tested > 0
        ? stats.exact / stats.tested
        : 0;

    const goalMAE =
      stats.tested > 0
        ? stats.goalError /
          (stats.tested * 2)
        : 0;

    const brier =
      stats.tested > 0
        ? stats.brier /
          stats.tested
        : 0;

    console.log("");

    console.log(
      `${model}`
    );

    console.log(
      `  Matches : ${stats.tested}`
    );

    console.log(
      `  1X2    : ${(accuracy * 100).toFixed(2)}%`
    );

    console.log(
      `  Exact  : ${(exact * 100).toFixed(2)}%`
    );

    console.log(
      `  MAE    : ${goalMAE.toFixed(3)}`
    );

    console.log(
      `  Brier  : ${brier.toFixed(4)}`
    );
  }
}

console.log("");
console.log("==============================================");

db.close();
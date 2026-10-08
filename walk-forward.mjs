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

function predictedResult(p) {

  if (
    p.homeProb >= p.drawProb &&
    p.homeProb >= p.awayProb
  ) {
    return "H";
  }

  if (p.drawProb >= p.awayProb) {
    return "D";
  }

  return "A";
}

/*
========================================
LEAGUE STATS
========================================
*/

function leagueStats(
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
========================================
POISSON
========================================
*/

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
========================================
V0.2
========================================
*/

function teamStats(
  team,
  competition,
  previous
) {

  const data =
    previous.filter(
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

    } else {

      gf += m.away_score;
      ga += m.home_score;
    }
  }

  return {
    goalsFor:
      gf / data.length,

    goalsAgainst:
      ga / data.length
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
========================================
V0.3
========================================
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

  if (!data.length) {
    return null;
  }

  let gf = 0;
  let ga = 0;
  let weightTotal = 0;

  for (let i = 0; i < data.length; i++) {

    const m = data[i];

    const weight =
      Math.pow(0.85, i);

    if (m.home_team === team) {

      gf +=
        m.home_score * weight;

      ga +=
        m.away_score * weight;

    } else {

      gf +=
        m.away_score * weight;

      ga +=
        m.home_score * weight;
    }

    weightTotal += weight;
  }

  return {
    goalsFor:
      gf / weightTotal,

    goalsAgainst:
      ga / weightTotal
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
========================================
V0.4 ELO
========================================
*/

function eloExpected(
  ratingA,
  ratingB
) {

  return 1 /
    (
      1 +
      Math.pow(
        10,
        (ratingB - ratingA) / 400
      )
    );
}

function calculateElo(
  competition,
  previous
) {

  const ratings = {};

  function rating(team) {

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
      rating(m.home_team);

    const awayRating =
      rating(m.away_team);

    const expected =
      eloExpected(
        homeRating + 60,
        awayRating
      );

    const actual =
      actualResult(
        m.home_score,
        m.away_score
      );

    let actualScore = 0;

    if (actual === "H") {
      actualScore = 1;
    }
    else if (actual === "D") {
      actualScore = 0.5;
    }

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
      25 *
      multiplier *
      (actualScore - expected);

    ratings[m.home_team] =
      homeRating + change;

    ratings[m.away_team] =
      awayRating - change;
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
    homeRating +
    60 -
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

/*
========================================
V0.5 DIXON-COLES
========================================
*/

function tau(
  hg,
  ag,
  lambdaHome,
  lambdaAway,
  rho
) {

  if (hg === 0 && ag === 0) {
    return 1 -
      lambdaHome *
      lambdaAway *
      rho;
  }

  if (hg === 0 && ag === 1) {
    return 1 +
      lambdaHome * rho;
  }

  if (hg === 1 && ag === 0) {
    return 1 +
      lambdaAway * rho;
  }

  if (hg === 1 && ag === 1) {
    return 1 - rho;
  }

  return 1;
}

function predictV05(
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

  let lambdaHome =
    league.homeGoals *
    homeAttack *
    awayDefense *
    1.05;

  let lambdaAway =
    league.awayGoals *
    awayAttack *
    homeDefense;

  lambdaHome =
    Math.max(
      0.2,
      Math.min(
        lambdaHome,
        4.5
      )
    );

  lambdaAway =
    Math.max(
      0.2,
      Math.min(
        lambdaAway,
        4.5
      )
    );

  const rho = -0.10;

  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;

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

    homeGoals: lambdaHome,

    awayGoals: lambdaAway,

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
WALK-FORWARD
========================================

Window:

minimum 30 historical matches
→ predict next match
→ move forward
→ repeat
*/

const models = {
  V02: predictV02,
  V03: predictV03,
  V04: predictV04,
  V05: predictV05
};

const competitions = [
  "Premier League",
  "La Liga"
];

const results = {};

for (const competition of competitions) {

  results[competition] = {};

  for (const model of Object.keys(models)) {

    results[competition][model] = {
      tested: 0,
      correct: 0,
      exact: 0,
      goalError: 0,
      brier: 0
    };
  }
}

/*
========================================
MAIN LOOP
========================================
*/

for (
  let i = 0;
  i < matches.length;
  i++
) {

  const match =
    matches[i];

  const previous =
    matches.slice(0, i);

  /*
  Minimal historical information.
  */

  if (previous.length < 30) {
    continue;
  }

  const competition =
    match.competition;

  if (
    !results[competition]
  ) {
    continue;
  }

  /*
  Only models that need the same
  competition history.
  */

  for (
    const [name, model] of
    Object.entries(models)
  ) {

    const prediction =
      model(
        match.home_team,
        match.away_team,
        competition,
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

    const stats =
      results[competition][name];

    if (predicted === actual) {
      stats.correct++;
    }

    if (
      Math.round(
        prediction.homeGoals
      ) === match.home_score &&
      Math.round(
        prediction.awayGoals
      ) === match.away_score
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

/*
========================================
OUTPUT
========================================
*/

console.log("");
console.log("==============================================");
console.log(" FOOTBALL ANALYTICS LAB");
console.log(" WALK-FORWARD VALIDATION");
console.log("==============================================");

for (
  const competition of competitions
) {

  console.log("");
  console.log("----------------------------------------------");
  console.log(competition);
  console.log("----------------------------------------------");

  for (
    const [model, stats] of
    Object.entries(
      results[competition]
    )
  ) {

    const accuracy =
      stats.tested > 0
        ? stats.correct /
          stats.tested
        : 0;

    const exact =
      stats.tested > 0
        ? stats.exact /
          stats.tested
        : 0;

    const mae =
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

    console.log(model);

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
      `  MAE    : ${mae.toFixed(3)}`
    );

    console.log(
      `  Brier  : ${brier.toFixed(4)}`
    );
  }
}

console.log("");
console.log("==============================================");

db.close();
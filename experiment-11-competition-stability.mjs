import Database from "better-sqlite3";

const db = new Database("./football.db", {
  readonly: true
});

console.log("========================================");
console.log("EXPERIMENT #11 — COMPETITION STABILITY");
console.log("========================================");
console.log("");

const THRESHOLD = 30;

const matches = db.prepare(`
  SELECT
    id,
    kickoff,
    competition,
    home_team,
    away_team,
    home_score,
    away_score,
    status
  FROM matches
  WHERE LOWER(status) = 'finished'
    AND home_score IS NOT NULL
    AND away_score IS NOT NULL
  ORDER BY kickoff ASC
`).all();

console.log("Total finished matches :", matches.length);
console.log("Threshold              :", THRESHOLD);
console.log("");

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

  if (prediction.drawProb >= prediction.awayProb) {
    return "D";
  }

  return "A";
}

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

  for (const match of data) {
    homeGoals += match.home_score;
    awayGoals += match.away_score;
  }

  return {
    homeGoals: homeGoals / data.length,
    awayGoals: awayGoals / data.length
  };
}

function teamStats(team, competition, previous) {
  const data = previous
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

  let goalsFor = 0;
  let goalsAgainst = 0;

  for (const match of data) {
    if (match.home_team === team) {
      goalsFor += match.home_score;
      goalsAgainst += match.away_score;
    } else {
      goalsFor += match.away_score;
      goalsAgainst += match.home_score;
    }
  }

  return {
    games: data.length,
    goalsFor,
    goalsAgainst
  };
}

function recentStats(team, competition, previous) {
  return previous
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
}

function predictV02(match, previous) {
  const league =
    leagueStats(
      match.competition,
      previous
    );

  const home =
    teamStats(
      match.home_team,
      match.competition,
      previous
    );

  const away =
    teamStats(
      match.away_team,
      match.competition,
      previous
    );

  if (
    home.games === 0 ||
    away.games === 0
  ) {
    return poissonPrediction(
      league.homeGoals,
      league.awayGoals
    );
  }

  const homeAttack =
    home.goalsFor /
    Math.max(
      league.homeGoals *
      home.games,
      0.1
    );

  const awayAttack =
    away.goalsFor /
    Math.max(
      league.awayGoals *
      away.games,
      0.1
    );

  const homeDefense =
    home.goalsAgainst /
    Math.max(
      league.awayGoals *
      home.games,
      0.1
    );

  const awayDefense =
    away.goalsAgainst /
    Math.max(
      league.homeGoals *
      away.games,
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

  homeGoals = Math.max(
    0.2,
    Math.min(homeGoals, 4.5)
  );

  awayGoals = Math.max(
    0.2,
    Math.min(awayGoals, 4.5)
  );

  return poissonPrediction(
    homeGoals,
    awayGoals
  );
}

function predictV03(match, previous) {
  const league =
    leagueStats(
      match.competition,
      previous
    );

  const homeRecent =
    recentStats(
      match.home_team,
      match.competition,
      previous
    );

  const awayRecent =
    recentStats(
      match.away_team,
      match.competition,
      previous
    );

  if (
    homeRecent.length === 0 ||
    awayRecent.length === 0
  ) {
    return predictV02(
      match,
      previous
    );
  }

  let homeGF = 0;
  let homeGA = 0;
  let awayGF = 0;
  let awayGA = 0;

  let homeWeight = 0;
  let awayWeight = 0;

  for (
    let i = 0;
    i < homeRecent.length;
    i++
  ) {
    const weight =
      Math.pow(0.85, i);

    const m = homeRecent[i];

    if (m.home_team === match.home_team) {
      homeGF +=
        m.home_score * weight;

      homeGA +=
        m.away_score * weight;
    } else {
      homeGF +=
        m.away_score * weight;

      homeGA +=
        m.home_score * weight;
    }

    homeWeight += weight;
  }

  for (
    let i = 0;
    i < awayRecent.length;
    i++
  ) {
    const weight =
      Math.pow(0.85, i);

    const m = awayRecent[i];

    if (m.home_team === match.away_team) {
      awayGF +=
        m.home_score * weight;

      awayGA +=
        m.away_score * weight;
    } else {
      awayGF +=
        m.away_score * weight;

      awayGA +=
        m.home_score * weight;
    }

    awayWeight += weight;
  }

  homeGF /= homeWeight;
  homeGA /= homeWeight;

  awayGF /= awayWeight;
  awayGA /= awayWeight;

  const homeAttack =
    homeGF /
    Math.max(
      league.homeGoals,
      0.1
    );

  const awayAttack =
    awayGF /
    Math.max(
      league.awayGoals,
      0.1
    );

  const homeDefense =
    homeGA /
    Math.max(
      league.awayGoals,
      0.1
    );

  const awayDefense =
    awayGA /
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

  homeGoals = Math.max(
    0.2,
    Math.min(homeGoals, 4.5)
  );

  awayGoals = Math.max(
    0.2,
    Math.min(awayGoals, 4.5)
  );

  return poissonPrediction(
    homeGoals,
    awayGoals
  );
}

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

function buildEloRatings(previous) {
  const ratings = new Map();

  for (const match of previous) {
    if (!ratings.has(match.home_team)) {
      ratings.set(
        match.home_team,
        1500
      );
    }

    if (!ratings.has(match.away_team)) {
      ratings.set(
        match.away_team,
        1500
      );
    }

    const homeRating =
      ratings.get(match.home_team);

    const awayRating =
      ratings.get(match.away_team);

    const expectedHome =
      eloExpected(
        homeRating + 60,
        awayRating
      );

    const expectedAway =
      1 - expectedHome;

    let multiplier = 1;

    const margin =
      Math.abs(
        match.home_score -
        match.away_score
      );

    if (margin === 2) {
      multiplier = 1.25;
    }

    if (margin >= 3) {
      multiplier = 1.50;
    }

    const actualHome =
      match.home_score >
      match.away_score
        ? 1
        : match.home_score ===
          match.away_score
          ? 0.5
          : 0;

    const actualAway =
      1 - actualHome;

    const changeHome =
      25 *
      multiplier *
      (
        actualHome -
        expectedHome
      );

    const changeAway =
      25 *
      multiplier *
      (
        actualAway -
        expectedAway
      );

    ratings.set(
      match.home_team,
      homeRating + changeHome
    );

    ratings.set(
      match.away_team,
      awayRating + changeAway
    );
  }

  return ratings;
}

function predictV04(match, previous) {
  const league =
    leagueStats(
      match.competition,
      previous
    );

  const ratings =
    buildEloRatings(previous);

  const homeRating =
    ratings.get(
      match.home_team
    ) ?? 1500;

  const awayRating =
    ratings.get(
      match.away_team
    ) ?? 1500;

  const difference =
    homeRating +
    60 -
    awayRating;

  let homeFactor =
    1 +
    difference / 1000;

  let awayFactor =
    1 -
    difference / 1200;

  homeFactor =
    Math.max(
      0.65,
      Math.min(
        homeFactor,
        1.35
      )
    );

  awayFactor =
    Math.max(
      0.65,
      Math.min(
        awayFactor,
        1.35
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

function predictV05(match, previous) {
  const base =
    predictV03(
      match,
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

      let tau = 1;

      if (hg === 0 && ag === 0) {
        tau =
          1 -
          base.homeGoals *
          base.awayGoals *
          rho;
      } else if (
        hg === 0 &&
        ag === 1
      ) {
        tau =
          1 +
          base.homeGoals *
          rho;
      } else if (
        hg === 1 &&
        ag === 0
      ) {
        tau =
          1 +
          base.awayGoals *
          rho;
      } else if (
        hg === 1 &&
        ag === 1
      ) {
        tau =
          1 - rho;
      }

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
    homeGoals:
      base.homeGoals,
    awayGoals:
      base.awayGoals,
    homeProb:
      homeProb / total,
    drawProb:
      drawProb / total,
    awayProb:
      awayProb / total
  };
}

const models = {
  V02: predictV02,
  V03: predictV03,
  V04: predictV04,
  V05: predictV05
};

function evaluateModel(
  modelFunction,
  competition
) {
  let tests = 0;
  let correct = 0;
  let exact = 0;

  let goalError = 0;
  let brier = 0;

  const competitionMatches =
    matches.filter(
      m =>
        m.competition ===
        competition
    );

  for (let i = 0; i < competitionMatches.length; i++) {
    const match =
      competitionMatches[i];

    const previous =
      matches.filter(
        m =>
          new Date(m.kickoff) <
          new Date(match.kickoff)
      );

    const previousCompetition =
      previous.filter(
        m =>
          m.competition ===
          competition
      );

    if (
      previousCompetition.length <
      THRESHOLD
    ) {
      continue;
    }

    const prediction =
      modelFunction(
        match,
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

    tests++;

    if (
      predicted === actual
    ) {
      correct++;
    }

    const predictedHomeGoals =
      Math.round(
        prediction.homeGoals
      );

    const predictedAwayGoals =
      Math.round(
        prediction.awayGoals
      );

    if (
      predictedHomeGoals ===
        match.home_score &&
      predictedAwayGoals ===
        match.away_score
    ) {
      exact++;
    }

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

    brier +=
      Math.pow(
        prediction.homeProb -
          (actual === "H"
            ? 1
            : 0),
        2
      );

    brier +=
      Math.pow(
        prediction.drawProb -
          (actual === "D"
            ? 1
            : 0),
        2
      );

    brier +=
      Math.pow(
        prediction.awayProb -
          (actual === "A"
            ? 1
            : 0),
        2
      );
  }

  return {
    tests,
    accuracy:
      tests > 0
        ? correct / tests
        : 0,
    exact:
      tests > 0
        ? exact / tests
        : 0,
    goalMae:
      tests > 0
        ? goalError /
          (tests * 2)
        : 0,
    brier:
      tests > 0
        ? brier /
          (tests * 3)
        : 0
  };
}

const competitions = [
  "Premier League",
  "La Liga"
];

for (
  const competition
  of competitions
) {
  console.log(
    "========================================"
  );

  console.log(
    `COMPETITION: ${competition}`
  );

  console.log(
    "========================================"
  );

  const competitionMatches =
    matches.filter(
      m =>
        m.competition ===
        competition
    );

  console.log(
    "Finished matches :",
    competitionMatches.length
  );

  console.log("");

  console.log(
    "Model | Tests | Accuracy | Exact | Goal MAE | Brier"
  );

  console.log(
    "----------------------------------------------------------"
  );

  for (
    const [name, model]
    of Object.entries(models)
  ) {
    const result =
      evaluateModel(
        model,
        competition
      );

    console.log(
      `${name.padEnd(5)} | ` +
      `${String(result.tests).padEnd(5)} | ` +
      `${(result.accuracy * 100)
        .toFixed(2)
        .padStart(7)}% | ` +
      `${(result.exact * 100)
        .toFixed(2)
        .padStart(5)}% | ` +
      `${result.goalMae
        .toFixed(4)
        .padStart(8)} | ` +
      `${result.brier
        .toFixed(4)
        .padStart(5)}`
    );
  }

  console.log("");
}

console.log(
  "========================================"
);

console.log(
  "EXPERIMENT #11 SELESAI"
);

console.log(
  "========================================"
);

console.log("");
console.log(
  "Threshold benchmark :",
  THRESHOLD
);

console.log(
  "Tidak ada perubahan pada model production."
);

db.close();
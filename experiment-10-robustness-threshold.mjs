import Database from "better-sqlite3";

const db = new Database("./football.db", {
  readonly: true
});

console.log("========================================");
console.log("EXPERIMENT #10 — ROBUSTNESS THRESHOLD");
console.log("========================================");
console.log("");

const matches = db.prepare(`
  SELECT
    id,
    kickoff,
    competition,
    home_team,
    away_team,
    home_score,
    away_score
  FROM matches
  WHERE LOWER(status) = 'finished'
    AND home_score IS NOT NULL
    AND away_score IS NOT NULL
  ORDER BY kickoff ASC
`).all();

console.log("Total finished matches :", matches.length);
console.log("");

const thresholds = [10, 20, 30, 40];

function actualResult(home, away) {
  if (home > away) return "H";
  if (home === away) return "D";
  return "A";
}

function poisson(lambda, k) {
  let factorial = 1;

  for (let i = 2; i <= k; i++) {
    factorial *= i;
  }

  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial;
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

  const total = homeProb + drawProb + awayProb;

  return {
    homeProb: homeProb / total,
    drawProb: drawProb / total,
    awayProb: awayProb / total
  };
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
        (m.home_team === team || m.away_team === team)
    )
    .sort(
      (a, b) =>
        new Date(b.kickoff) - new Date(a.kickoff)
    );

  let goalsFor = 0;
  let goalsAgainst = 0;
  let games = 0;

  for (const match of data) {
    games++;

    if (match.home_team === team) {
      goalsFor += match.home_score;
      goalsAgainst += match.away_score;
    } else {
      goalsFor += match.away_score;
      goalsAgainst += match.home_score;
    }
  }

  return {
    games,
    goalsFor,
    goalsAgainst
  };
}

function predictV02(match, previous) {
  const league = leagueStats(
    match.competition,
    previous
  );

  const home = teamStats(
    match.home_team,
    match.competition,
    previous
  );

  const away = teamStats(
    match.away_team,
    match.competition,
    previous
  );

  if (
    home.games === 0 ||
    away.games === 0
  ) {
    return {
      homeGoals: league.homeGoals,
      awayGoals: league.awayGoals,
      ...poissonPrediction(
        league.homeGoals,
        league.awayGoals
      )
    };
  }

  const homeAttack =
    home.goalsFor /
    Math.max(
      league.homeGoals * home.games,
      0.1
    );

  const awayAttack =
    away.goalsFor /
    Math.max(
      league.awayGoals * away.games,
      0.1
    );

  const homeDefense =
    home.goalsAgainst /
    Math.max(
      league.awayGoals * home.games,
      0.1
    );

  const awayDefense =
    away.goalsAgainst /
    Math.max(
      league.homeGoals * away.games,
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

  return {
    homeGoals,
    awayGoals,
    ...poissonPrediction(
      homeGoals,
      awayGoals
    )
  };
}

function evaluateThreshold(threshold) {
  let tests = 0;
  let correct = 0;
  let exact = 0;

  let goalError = 0;
  let brier = 0;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];

    const previous = matches.filter(
      m =>
        new Date(m.kickoff) <
        new Date(match.kickoff)
    );

    const previousCompetition =
      previous.filter(
        m =>
          m.competition ===
          match.competition
      );

    if (
      previousCompetition.length <
      threshold
    ) {
      continue;
    }

    const prediction =
      predictV02(
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

    if (predicted === actual) {
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
  }

  return {
    threshold,
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

const results =
  thresholds.map(
    threshold =>
      evaluateThreshold(
        threshold
      )
  );

console.log(
  "Threshold | Tests | Accuracy | Exact | Goal MAE | Brier"
);

console.log(
  "----------------------------------------------------------"
);

for (const result of results) {
  console.log(
    `${String(result.threshold).padEnd(9)} | ` +
    `${String(result.tests).padEnd(5)} | ` +
    `${(result.accuracy * 100).toFixed(2).padStart(7)}% | ` +
    `${(result.exact * 100).toFixed(2).padStart(5)}% | ` +
    `${result.goalMae.toFixed(4).padStart(8)} | ` +
    `${result.brier.toFixed(4).padStart(5)}`
  );
}

console.log("");
console.log(
  "Catatan: threshold hanya menentukan jumlah"
);
console.log(
  "riwayat pertandingan minimum sebelum sebuah"
);
console.log(
  "match masuk evaluasi. Tidak ada perubahan"
);
console.log(
  "pada model produksi."
);

db.close();
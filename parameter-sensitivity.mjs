/*
==================================================
PARAMETER SENSITIVITY TEST
V0.3 RECENT FORM — DECAY
==================================================

Tujuan:
Menguji apakah decay 0.70–0.95
memberikan performa berbeda.

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

function leagueStats(
  competition,
  previous
) {

  const data =
    previous.filter(
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
==================================================
RECENT FORM
==================================================
*/

function recentStats(
  team,
  competition,
  previous,
  decay
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

  let weightedGF = 0;
  let weightedGA = 0;
  let totalWeight = 0;

  for (let i = 0; i < data.length; i++) {

    const m = data[i];

    const weight =
      Math.pow(decay, i);

    let gf;
    let ga;

    if (m.home_team === team) {

      gf = m.home_score;
      ga = m.away_score;

    } else {

      gf = m.away_score;
      ga = m.home_score;
    }

    weightedGF +=
      gf * weight;

    weightedGA +=
      ga * weight;

    totalWeight += weight;
  }

  return {
    goalsFor:
      weightedGF / totalWeight,

    goalsAgainst:
      weightedGA / totalWeight
  };
}

/*
==================================================
POISSON PREDICTION
==================================================
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
V0.3
==================================================
*/

function predictV03(
  homeTeam,
  awayTeam,
  competition,
  previous,
  decay
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
      previous,
      decay
    );

  const away =
    recentStats(
      awayTeam,
      competition,
      previous,
      decay
    );

  /*
  Fallback yang sama dengan
  evaluation-engine.mjs
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
    awayDefense *
    1.05;

  let awayGoals =
    league.awayGoals *
    awayAttack *
    homeDefense;

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
TEST CONFIGURATIONS
==================================================
*/

const decayValues = [
  0.70,
  0.75,
  0.80,
  0.85,
  0.90,
  0.95
];

const results = {};

for (const decay of decayValues) {

  results[decay] = {
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

for (let i = 0; i < matches.length; i++) {

  const match = matches[i];

  /*
  Hanya pertandingan SEBELUM
  target yang boleh digunakan.
  */

  const previous =
    matches.filter(
      m =>
        m.kickoff <
        match.kickoff
    );

  /*
  Minimal 30 pertandingan
  historis dalam kompetisi.
  */

  const competitionHistory =
    previous.filter(
      m =>
        m.competition ===
        match.competition
    );

  if (
    competitionHistory.length < 30
  ) {
    continue;
  }

  const actual =
    actualResult(
      match.home_score,
      match.away_score
    );

  /*
  Semua decay diuji pada
  target match yang sama.
  */

  for (const decay of decayValues) {

    const prediction =
      predictV03(
        match.home_team,
        match.away_team,
        match.competition,
        previous,
        decay
      );

    const predicted =
      predictedResult(
        prediction
      );

    const stats =
      results[decay];

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
      ) === match.home_score &&

      Math.round(
        prediction.awayGoals
      ) === match.away_score
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
    BRIER SCORE
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
  " V0.3 DECAY SENSITIVITY TEST"
);

console.log(
  "=================================================="
);

console.log("");

console.log(
  "Decay | Tests | Accuracy | Exact | Goal MAE | Brier"
);

console.log(
  "------|-------|----------|-------|----------|------"
);

for (const decay of decayValues) {

  const s =
    results[decay];

  const accuracy =
    s.tested
      ? s.correct / s.tested
      : 0;

  const exact =
    s.tested
      ? s.exact / s.tested
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
    `${decay.toFixed(2).padEnd(5)} | ` +
    `${String(s.tested).padEnd(5)} | ` +
    `${(accuracy * 100).toFixed(2).padStart(8)}% | ` +
    `${(exact * 100).toFixed(2).padStart(5)}% | ` +
    `${goalMAE.toFixed(4).padStart(8)} | ` +
    `${brier.toFixed(4).padStart(6)}`
  );
}

console.log("");

console.log(
  "Catatan:"
);

console.log(
  "- Accuracy / Exact: semakin tinggi semakin baik."
);

console.log(
  "- Goal MAE / Brier: semakin rendah semakin baik."
);

console.log(
  "- Semua konfigurasi memakai target match yang sama."
);

console.log(
  "- Database tidak diubah."
);

console.log("");

db.close();
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

function baselinePrediction() {
  return {
    home_prob: 0.45,
    draw_prob: 0.27,
    away_prob: 0.28,
    predicted_home_goals: 1.55,
    predicted_away_goals: 1.05
  };
}

function actualResult(home, away) {
  if (home > away) return "H";
  if (home < away) return "A";
  return "D";
}

function predictedResult(prediction) {
  const probabilities = {
    H: prediction.home_prob,
    D: prediction.draw_prob,
    A: prediction.away_prob
  };

  return Object.entries(probabilities)
    .sort((a, b) => b[1] - a[1])[0][0];
}

let tested = 0;
let resultHits = 0;
let exactScoreHits = 0;

let totalHomeGoalError = 0;
let totalAwayGoalError = 0;
let totalBrier = 0;

for (const match of matches) {

  /*
   * IMPORTANT:
   * Simulasi prediksi hanya menggunakan informasi
   * sebelum pertandingan target.
   */
  const previousMatches = matches.filter(
    m => new Date(m.kickoff) < new Date(match.kickoff)
  );

  /*
   * Untuk V0.1 kita masih menggunakan baseline.
   * Nanti bagian ini akan diganti model statistik/ML.
   */
  const prediction = baselinePrediction();

  const actual = actualResult(
    match.home_score,
    match.away_score
  );

  const predicted = predictedResult(prediction);

  if (predicted === actual) {
    resultHits++;
  }

  if (
    Math.round(prediction.predicted_home_goals) === match.home_score &&
    Math.round(prediction.predicted_away_goals) === match.away_score
  ) {
    exactScoreHits++;
  }

  totalHomeGoalError += Math.abs(
    prediction.predicted_home_goals - match.home_score
  );

  totalAwayGoalError += Math.abs(
    prediction.predicted_away_goals - match.away_score
  );

  const actualVector = {
    H: actual === "H" ? 1 : 0,
    D: actual === "D" ? 1 : 0,
    A: actual === "A" ? 1 : 0
  };

  totalBrier +=
    Math.pow(prediction.home_prob - actualVector.H, 2) +
    Math.pow(prediction.draw_prob - actualVector.D, 2) +
    Math.pow(prediction.away_prob - actualVector.A, 2);

  tested++;
}

const accuracy = tested
  ? resultHits / tested
  : 0;

const exactScoreRate = tested
  ? exactScoreHits / tested
  : 0;

const goalMae = tested
  ? (totalHomeGoalError + totalAwayGoalError) / (tested * 2)
  : 0;

const brierScore = tested
  ? totalBrier / tested
  : 0;

console.log("\n====================================");
console.log(" FOOTBALL ANALYTICS LAB - BACKTEST");
console.log(" MODEL: V0.1 BASELINE");
console.log("====================================");

console.log("Matches tested :", tested);
console.log(
  "1X2 accuracy   :",
  `${(accuracy * 100).toFixed(2)}%`
);
console.log(
  "Exact score    :",
  `${(exactScoreRate * 100).toFixed(2)}%`
);
console.log(
  "Goal MAE       :",
  goalMae.toFixed(3)
);
console.log(
  "Brier score    :",
  brierScore.toFixed(4)
);

console.log("====================================\n");

db.close();

import Database from "better-sqlite3";
import {
  actualResult,
  predictedResult,
  predictV02,
  predictV04,
} from "./evaluation-models.mjs";

const db = new Database("football.db", { readonly: true });

const expected = {
  10: {
    tests: 99,
    v02Accuracy: 46.46,
    v02Exact: 8.08,
    v02GoalMAE: 1.2985,
  },
  20: {
    tests: 79,
    v02Accuracy: 49.37,
    v02Exact: 10.13,
    v02GoalMAE: 1.2261,
  },
  30: {
    tests: 59,
    v02Accuracy: 50.85,
    v02Exact: 11.86,
    v02GoalMAE: 1.2322,
  },
  40: {
    tests: 39,
    v02Accuracy: 51.28,
    v02Exact: 10.26,
    v02GoalMAE: 1.1804,
  },
};

function scorePrediction(prediction, match) {
  const actual = actualResult(
    Number(match.home_score),
    Number(match.away_score)
  );

  const predicted = predictedResult(prediction);

  return {
    correct: predicted === actual ? 1 : 0,
    exact:
      Math.round(prediction.homeGoals) === Number(match.home_score) &&
      Math.round(prediction.awayGoals) === Number(match.away_score)
        ? 1
        : 0,
    goalError:
      (
        Math.abs(prediction.homeGoals - Number(match.home_score)) +
        Math.abs(prediction.awayGoals - Number(match.away_score))
      ) / 2,
  };
}

function summarize(rows) {
  if (rows.length === 0) {
    return { tests: 0, accuracy: 0, exact: 0, goalMAE: 0 };
  }

  return {
    tests: rows.length,
    accuracy:
      (rows.reduce((sum, row) => sum + row.correct, 0) / rows.length) * 100,
    exact:
      (rows.reduce((sum, row) => sum + row.exact, 0) / rows.length) * 100,
    goalMAE:
      rows.reduce((sum, row) => sum + row.goalError, 0) / rows.length,
  };
}

function near(actual, target, tolerance = 0.015) {
  return Math.abs(actual - target) <= tolerance;
}

try {
  const matches = db.prepare(`
    SELECT *
    FROM matches
    WHERE LOWER(status) = 'finished'
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
      AND kickoff IS NOT NULL
    ORDER BY kickoff ASC
  `).all();

  console.log("\n==============================================");
  console.log("EXPERIMENT #13 — MODEL CONSISTENCY AUDIT");
  console.log("==============================================");
  console.log(`Finished matches loaded: ${matches.length}`);
  console.log("Database: READ ONLY");
  console.log("Production model: unchanged");

  const allResults = {};

  for (const threshold of [10, 20, 30, 40]) {
    const v02Rows = [];
    const v04Rows = [];

    for (const match of matches) {
      const kickoff = new Date(match.kickoff).getTime();

      const previous = matches.filter(
        (prior) => new Date(prior.kickoff).getTime() < kickoff
      );

      const previousInCompetition = previous.filter(
        (prior) => prior.competition === match.competition
      );

      if (previousInCompetition.length < threshold) continue;

      v02Rows.push(scorePrediction(predictV02(match, previous), match));
      v04Rows.push(scorePrediction(predictV04(match, previous), match));
    }

    const v02 = summarize(v02Rows);
    const v04 = summarize(v04Rows);
    const baseline = expected[threshold];

    const matchesCheck = v02.tests === baseline.tests;
    const accuracyCheck = near(v02.accuracy, baseline.v02Accuracy);
    const exactCheck = near(v02.exact, baseline.v02Exact);
    const goalCheck = near(v02.goalMAE, baseline.v02GoalMAE, 0.001);

    allResults[threshold] = { v02, v04 };

    console.log(`\n--- Threshold ${threshold} ---`);
    console.log(`Tes sekarang       : ${v02.tests}`);
    console.log(
      `V0.2 accuracy      : ${v02.accuracy.toFixed(2)}% ` +
      `(catatan lama ${baseline.v02Accuracy.toFixed(2)}%)`
    );
    console.log(
      `V0.2 exact score   : ${v02.exact.toFixed(2)}% ` +
      `(catatan lama ${baseline.v02Exact.toFixed(2)}%)`
    );
    console.log(
      `V0.2 Goal MAE      : ${v02.goalMAE.toFixed(4)} ` +
      `(catatan lama ${baseline.v02GoalMAE.toFixed(4)})`
    );
    console.log(`V0.4 accuracy      : ${v04.accuracy.toFixed(2)}%`);
    console.log(`V0.4 Goal MAE      : ${v04.goalMAE.toFixed(4)}`);

    console.log(
      `Jumlah tes         : ${matchesCheck ? "COCOK" : "BERBEDA"}`
    );
    console.log(
      `Akurasi V0.2       : ${accuracyCheck ? "COCOK" : "BERBEDA"}`
    );
    console.log(
      `Exact score V0.2   : ${exactCheck ? "COCOK" : "BERBEDA"}`
    );
    console.log(
      `Goal MAE V0.2      : ${goalCheck ? "COCOK" : "BERBEDA"}`
    );
  }

  console.log("\n--- Audit per kompetisi: threshold 30 ---");

  const competitions = [...new Set(matches.map((m) => m.competition))];

  for (const competition of competitions) {
    const v02Rows = [];
    const v04Rows = [];

    for (const match of matches.filter(
      (m) => m.competition === competition
    )) {
      const kickoff = new Date(match.kickoff).getTime();

      const previous = matches.filter(
        (prior) => new Date(prior.kickoff).getTime() < kickoff
      );

      const previousInCompetition = previous.filter(
        (prior) => prior.competition === competition
      );

      if (previousInCompetition.length < 30) continue;

      v02Rows.push(scorePrediction(predictV02(match, previous), match));
      v04Rows.push(scorePrediction(predictV04(match, previous), match));
    }

    const a = summarize(v02Rows);
    const b = summarize(v04Rows);

    console.log(`\nKompetisi: ${competition}`);
    console.log(
      `V0.2: tes=${a.tests}, akurasi=${a.accuracy.toFixed(2)}%, ` +
      `exact=${a.exact.toFixed(2)}%, MAE=${a.goalMAE.toFixed(4)}`
    );
    console.log(
      `V0.4: tes=${b.tests}, akurasi=${b.accuracy.toFixed(2)}%, ` +
      `exact=${b.exact.toFixed(2)}%, MAE=${b.goalMAE.toFixed(4)}`
    );
  }

  console.log("\n==============================================");
  console.log("AUDIT SELESAI");
  console.log("Jika ada status BERBEDA, jangan promosikan model dulu.");
  console.log("==============================================\n");
} catch (error) {
  console.error("\nAudit gagal:");
  console.error(error.stack || error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
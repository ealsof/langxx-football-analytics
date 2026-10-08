
import Database from "better-sqlite3";
import {
  actualResult,
  predictedResult,
  predictV02,
  predictV04,
} from "./evaluation-models.mjs";

const db = new Database("football.db", { readonly: true });

const thresholds = [10, 20, 30, 40];

const weights = [
  { v02: 0.7, v04: 0.3 },
  { v02: 0.6, v04: 0.4 },
  { v02: 0.5, v04: 0.5 },
  { v02: 0.4, v04: 0.6 },
  { v02: 0.3, v04: 0.7 },
];

function evaluate(prediction, match) {
  const actual = actualResult(
    Number(match.home_score),
    Number(match.away_score)
  );

  const predicted = predictedResult(prediction);

  const actualHome = Number(match.home_score);
  const actualAway = Number(match.away_score);

  const exactHome = Math.round(prediction.homeGoals);
  const exactAway = Math.round(prediction.awayGoals);

  const brier =
    (
      Math.pow(prediction.homeProb - (actual === "H" ? 1 : 0), 2) +
      Math.pow(prediction.drawProb - (actual === "D" ? 1 : 0), 2) +
      Math.pow(prediction.awayProb - (actual === "A" ? 1 : 0), 2)
    ) / 3;

  return {
    correct: predicted === actual ? 1 : 0,
    exact: exactHome === actualHome && exactAway === actualAway ? 1 : 0,
    goalError:
      (Math.abs(prediction.homeGoals - actualHome) +
        Math.abs(prediction.awayGoals - actualAway)) /
      2,
    brier,
  };
}

function combinePredictions(predV02, predV04, weight) {
  const a = weight.v02;
  const b = weight.v04;

  return {
    homeGoals: a * predV02.homeGoals + b * predV04.homeGoals,
    awayGoals: a * predV02.awayGoals + b * predV04.awayGoals,
    homeProb: a * predV02.homeProb + b * predV04.homeProb,
    drawProb: a * predV02.drawProb + b * predV04.drawProb,
    awayProb: a * predV02.awayProb + b * predV04.awayProb,
  };
}

function summarize(rows) {
  if (!rows.length) {
    return {
      tests: 0,
      accuracy: null,
      exact: null,
      goalMAE: null,
      brier: null,
    };
  }

  const total = rows.reduce(
    (acc, row) => ({
      correct: acc.correct + row.correct,
      exact: acc.exact + row.exact,
      goalError: acc.goalError + row.goalError,
      brier: acc.brier + row.brier,
    }),
    { correct: 0, exact: 0, goalError: 0, brier: 0 }
  );

  return {
    tests: rows.length,
    accuracy: (total.correct / rows.length) * 100,
    exact: (total.exact / rows.length) * 100,
    goalMAE: total.goalError / rows.length,
    brier: total.brier / rows.length,
  };
}

function fmt(value, suffix = "") {
  return value === null || value === undefined
    ? "N/A"
    : `${value.toFixed(2)}${suffix}`;
}

try {
  const matches = db
    .prepare(`
      SELECT *
      FROM matches
      WHERE LOWER(status) = 'finished'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND kickoff IS NOT NULL
      ORDER BY kickoff ASC
    `)
    .all();

  if (!matches.length) {
    throw new Error(
      "Tidak ada pertandingan selesai dengan skor lengkap di tabel matches."
    );
  }

  console.log("\n==============================================");
  console.log("EXPERIMENT #12 — ENSEMBLE STABILITY");
  console.log("==============================================");
  console.log(`Total pertandingan selesai: ${matches.length}`);
  console.log("Database dibuka dalam mode read-only.");
  console.log("Model produksi tidak diubah.\n");

  for (const threshold of thresholds) {
    const resultRows = new Map();

    resultRows.set("V0.2", []);
    resultRows.set("V0.4", []);

    for (const weight of weights) {
      resultRows.set(
        `${Math.round(weight.v02 * 100)}:${Math.round(weight.v04 * 100)}`,
        []
      );
    }

    for (const match of matches) {
      const kickoffTime = new Date(match.kickoff).getTime();

      const previous = matches.filter(
        (prior) =>
          new Date(prior.kickoff).getTime() < kickoffTime
      );

      const previousInCompetition = previous.filter(
        (prior) => prior.competition === match.competition
      );

      if (previousInCompetition.length < threshold) continue;

      const predV02 = predictV02(match, previous);
      const predV04 = predictV04(match, previous);

      resultRows.get("V0.2").push(evaluate(predV02, match));
      resultRows.get("V0.4").push(evaluate(predV04, match));

      for (const weight of weights) {
        const key =
          `${Math.round(weight.v02 * 100)}:${Math.round(weight.v04 * 100)}`;

        const ensemble = combinePredictions(predV02, predV04, weight);
        resultRows.get(key).push(evaluate(ensemble, match));
      }
    }

    console.log(`\n--- Threshold ${threshold} ---`);
    console.log(
      "Model          Tes   Akurasi   Skor tepat   Goal MAE   Brier"
    );
    console.log("-".repeat(68));

    for (const [model, rows] of resultRows.entries()) {
      const stats = summarize(rows);

      console.log(
        `${model.padEnd(14)} ` +
        `${String(stats.tests).padStart(3)}   ` +
        `${fmt(stats.accuracy, "%").padStart(8)}   ` +
        `${fmt(stats.exact, "%").padStart(9)}   ` +
        `${fmt(stats.goalMAE).padStart(8)}   ` +
        `${fmt(stats.brier).padStart(6)}`
      );
    }
  }

  console.log("\n==============================================");
  console.log("CARA MEMBACA HASIL");
  console.log("==============================================");
  console.log("- Akurasi: makin tinggi makin baik.");
  console.log("- Skor tepat: persentase skor akhir yang cocok setelah pembulatan.");
  console.log("- Goal MAE: makin rendah makin baik.");
  console.log("- Brier: makin rendah makin baik.");
  console.log("- Bandingkan juga jumlah tes; sampel kecil lebih mudah berubah.");
  console.log("- Eksperimen ini tidak mengubah model produksi.");
} catch (error) {
  console.error("\nExperiment #12 gagal dijalankan:");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
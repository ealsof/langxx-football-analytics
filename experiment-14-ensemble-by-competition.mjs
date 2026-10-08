import Database from "better-sqlite3";
import {
  actualResult,
  predictedResult,
  predictV02,
  predictV04,
} from "./evaluation-models.mjs";

const db = new Database("football.db", { readonly: true });

const THRESHOLD = 30;

const weights = [
  { name: "V0.2", v02: 1.0, v04: 0.0 },
  { name: "V0.4", v02: 0.0, v04: 1.0 },
  { name: "70:30", v02: 0.7, v04: 0.3 },
  { name: "60:40", v02: 0.6, v04: 0.4 },
  { name: "50:50", v02: 0.5, v04: 0.5 },
  { name: "40:60", v02: 0.4, v04: 0.6 },
  { name: "30:70", v02: 0.3, v04: 0.7 },
];

function combinePredictions(v02, v04, weight) {
  return {
    homeGoals:
      weight.v02 * v02.homeGoals +
      weight.v04 * v04.homeGoals,

    awayGoals:
      weight.v02 * v02.awayGoals +
      weight.v04 * v04.awayGoals,

    homeProb:
      weight.v02 * v02.homeProb +
      weight.v04 * v04.homeProb,

    drawProb:
      weight.v02 * v02.drawProb +
      weight.v04 * v04.drawProb,

    awayProb:
      weight.v02 * v02.awayProb +
      weight.v04 * v04.awayProb,
  };
}

function evaluate(prediction, match) {
  const actual = actualResult(
    Number(match.home_score),
    Number(match.away_score)
  );

  const predicted = predictedResult(prediction);

  const actualHome = Number(match.home_score);
  const actualAway = Number(match.away_score);

  const exact =
    Math.round(prediction.homeGoals) === actualHome &&
    Math.round(prediction.awayGoals) === actualAway;

  const brier =
    (
      Math.pow(
        prediction.homeProb - (actual === "H" ? 1 : 0),
        2
      ) +
      Math.pow(
        prediction.drawProb - (actual === "D" ? 1 : 0),
        2
      ) +
      Math.pow(
        prediction.awayProb - (actual === "A" ? 1 : 0),
        2
      )
    ) / 3;

  return {
    correct: predicted === actual ? 1 : 0,
    exact: exact ? 1 : 0,

    goalError:
      (
        Math.abs(prediction.homeGoals - actualHome) +
        Math.abs(prediction.awayGoals - actualAway)
      ) / 2,

    brier,
  };
}

function summarize(rows) {
  if (!rows.length) {
    return {
      tests: 0,
      accuracy: 0,
      exact: 0,
      goalMAE: 0,
      brier: 0,
    };
  }

  const total = rows.reduce(
    (sum, row) => ({
      correct: sum.correct + row.correct,
      exact: sum.exact + row.exact,
      goalError: sum.goalError + row.goalError,
      brier: sum.brier + row.brier,
    }),
    {
      correct: 0,
      exact: 0,
      goalError: 0,
      brier: 0,
    }
  );

  return {
    tests: rows.length,

    accuracy:
      (total.correct / rows.length) * 100,

    exact:
      (total.exact / rows.length) * 100,

    goalMAE:
      total.goalError / rows.length,

    brier:
      total.brier / rows.length,
  };
}

function fmt(value, digits = 2) {
  return Number(value).toFixed(digits);
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

  console.log("\n==============================================");
  console.log("EXPERIMENT #14 — ENSEMBLE BY COMPETITION");
  console.log("==============================================");

  console.log(`Total pertandingan selesai : ${matches.length}`);
  console.log(`Threshold                  : ${THRESHOLD}`);
  console.log("Database                   : READ ONLY");
  console.log("Model produksi             : UNCHANGED");

  const competitions = [
    "Premier League",
    "La Liga",
  ];

  for (const competition of competitions) {
    console.log("\n==============================================");
    console.log(`KOMPETISI: ${competition}`);
    console.log("==============================================");

    const resultMap = new Map();

    for (const weight of weights) {
      resultMap.set(weight.name, []);
    }

    const competitionMatches = matches.filter(
      (match) => match.competition === competition
    );

    console.log(
      `Total pertandingan selesai di kompetisi: ${competitionMatches.length}`
    );

    for (const match of competitionMatches) {
      const kickoffTime =
        new Date(match.kickoff).getTime();

      const previous = matches.filter(
        (prior) =>
          new Date(prior.kickoff).getTime() <
          kickoffTime
      );

      const previousInCompetition =
        previous.filter(
          (prior) =>
            prior.competition === competition
        );

      if (
        previousInCompetition.length <
        THRESHOLD
      ) {
        continue;
      }

      const v02 =
        predictV02(match, previous);

      const v04 =
        predictV04(match, previous);

      for (const weight of weights) {
        const prediction =
          combinePredictions(
            v02,
            v04,
            weight
          );

        const evaluation =
          evaluate(
            prediction,
            match
          );

        resultMap
          .get(weight.name)
          .push(evaluation);
      }
    }

    console.log(
      "\nModel          Tes   Akurasi   Exact    Goal MAE   Brier"
    );

    console.log(
      "------------------------------------------------------------"
    );

    for (const weight of weights) {
      const stats =
        summarize(
          resultMap.get(weight.name)
        );

      console.log(
        `${weight.name.padEnd(14)}` +
        `${String(stats.tests).padStart(3)}   ` +
        `${fmt(stats.accuracy).padStart(7)}%   ` +
        `${fmt(stats.exact).padStart(6)}%   ` +
        `${fmt(stats.goalMAE, 4).padStart(8)}   ` +
        `${fmt(stats.brier, 4).padStart(7)}`
      );
    }

    console.log(
      "\nInterpretasi:"
    );

    console.log(
      "- Accuracy semakin tinggi semakin baik."
    );

    console.log(
      "- Exact score semakin tinggi semakin baik."
    );

    console.log(
      "- Goal MAE semakin rendah semakin baik."
    );

    console.log(
      "- Brier semakin rendah semakin baik."
    );
  }

  console.log("\n==============================================");
  console.log("EXPERIMENT #14 SELESAI");
  console.log("==============================================");

  console.log(
    "\nModel produksi tetap tidak berubah."
  );

} catch (error) {
  console.error(
    "\nExperiment #14 gagal:"
  );

  console.error(
    error.stack || error.message
  );

  process.exitCode = 1;

} finally {
  db.close();
}
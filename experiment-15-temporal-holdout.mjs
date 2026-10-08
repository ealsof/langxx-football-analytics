import Database from "better-sqlite3";
import {
  actualResult,
  predictedResult,
  predictV02,
  predictV04,
} from "./evaluation-models.mjs";

const db = new Database("football.db", {
  readonly: true,
});

const THRESHOLD = 30;

// Bobot dikunci berdasarkan hasil eksperimen sebelumnya.
const ENSEMBLE_WEIGHT = {
  v02: 0.6,
  v04: 0.4,
};

const HOLDOUT_RATIO = 0.4;

function combinePredictions(v02, v04) {
  return {
    homeGoals:
      ENSEMBLE_WEIGHT.v02 * v02.homeGoals +
      ENSEMBLE_WEIGHT.v04 * v04.homeGoals,

    awayGoals:
      ENSEMBLE_WEIGHT.v02 * v02.awayGoals +
      ENSEMBLE_WEIGHT.v04 * v04.awayGoals,

    homeProb:
      ENSEMBLE_WEIGHT.v02 * v02.homeProb +
      ENSEMBLE_WEIGHT.v04 * v04.homeProb,

    drawProb:
      ENSEMBLE_WEIGHT.v02 * v02.drawProb +
      ENSEMBLE_WEIGHT.v04 * v04.drawProb,

    awayProb:
      ENSEMBLE_WEIGHT.v02 * v02.awayProb +
      ENSEMBLE_WEIGHT.v04 * v04.awayProb,
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
        Math.abs(
          prediction.homeGoals - actualHome
        ) +
        Math.abs(
          prediction.awayGoals - actualAway
        )
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

  const totals = rows.reduce(
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
      (totals.correct / rows.length) * 100,
    exact:
      (totals.exact / rows.length) * 100,
    goalMAE:
      totals.goalError / rows.length,
    brier:
      totals.brier / rows.length,
  };
}

function printTable(results) {
  console.log(
    "\nModel          Tes   Akurasi   Exact    Goal MAE   Brier"
  );

  console.log(
    "------------------------------------------------------------"
  );

  for (const [model, rows] of Object.entries(results)) {
    const stats = summarize(rows);

    console.log(
      `${model.padEnd(14)}` +
      `${String(stats.tests).padStart(3)}   ` +
      `${stats.accuracy.toFixed(2).padStart(7)}%   ` +
      `${stats.exact.toFixed(2).padStart(6)}%   ` +
      `${stats.goalMAE.toFixed(4).padStart(8)}   ` +
      `${stats.brier.toFixed(4).padStart(7)}`
    );
  }
}

function prepareCompetitionData(matches, competition) {
  const competitionMatches = matches
    .filter(
      (match) => match.competition === competition
    )
    .sort(
      (a, b) =>
        new Date(a.kickoff) -
        new Date(b.kickoff)
    );

  const eligible = [];

  for (const match of competitionMatches) {
    const kickoffTime =
      new Date(match.kickoff).getTime();

    const previousInCompetition =
      competitionMatches.filter(
        (prior) =>
          new Date(prior.kickoff).getTime() <
          kickoffTime
      );

    if (
      previousInCompetition.length >= THRESHOLD
    ) {
      eligible.push(match);
    }
  }

  return {
    competitionMatches,
    eligible,
  };
}

function evaluateMatches(matches, allMatches) {
  const results = {
    "V0.2": [],
    "V0.4": [],
    "60:40": [],
  };

  for (const match of matches) {
    const kickoffTime =
      new Date(match.kickoff).getTime();

    const previous = allMatches.filter(
      (prior) =>
        new Date(prior.kickoff).getTime() <
        kickoffTime
    );

    const v02 =
      predictV02(match, previous);

    const v04 =
      predictV04(match, previous);

    const ensemble =
      combinePredictions(v02, v04);

    results["V0.2"].push(
      evaluate(v02, match)
    );

    results["V0.4"].push(
      evaluate(v04, match)
    );

    results["60:40"].push(
      evaluate(ensemble, match)
    );
  }

  return results;
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

  console.log(
    "\n=============================================="
  );

  console.log(
    "EXPERIMENT #15 — TEMPORAL HOLDOUT"
  );

  console.log(
    "=============================================="
  );

  console.log(
    `Total pertandingan selesai : ${matches.length}`
  );

  console.log(
    `Threshold                  : ${THRESHOLD}`
  );

  console.log(
    `Holdout ratio              : ${HOLDOUT_RATIO * 100}%`
  );

  console.log(
    "Ensemble                   : V0.2 60% + V0.4 40%"
  );

  console.log(
    "Database                   : READ ONLY"
  );

  console.log(
    "Model produksi             : UNCHANGED"
  );

  const competitions = [
    "Premier League",
    "La Liga",
  ];

  const combinedAll = {
    "V0.2": [],
    "V0.4": [],
    "60:40": [],
  };

  for (const competition of competitions) {
    const {
      competitionMatches,
      eligible,
    } = prepareCompetitionData(
      matches,
      competition
    );

    if (!eligible.length) {
      console.log(
        `\nTidak ada data eligible untuk ${competition}.`
      );
      continue;
    }

    const holdoutCount =
      Math.max(
        1,
        Math.ceil(
          eligible.length * HOLDOUT_RATIO
        )
      );

    const holdoutStart =
      eligible.length - holdoutCount;

    const development =
      eligible.slice(0, holdoutStart);

    const holdout =
      eligible.slice(holdoutStart);

    console.log(
      "\n=============================================="
    );

    console.log(
      `KOMPETISI: ${competition}`
    );

    console.log(
      "=============================================="
    );

    console.log(
      `Total selesai kompetisi : ${competitionMatches.length}`
    );

    console.log(
      `Eligible threshold ${THRESHOLD} : ${eligible.length}`
    );

    console.log(
      `Development portion     : ${development.length}`
    );

    console.log(
      `Holdout portion         : ${holdout.length}`
    );

    if (development.length) {
      console.log(
        `Development pertama     : ${development[0].kickoff}`
      );

      console.log(
        `Development terakhir    : ${
          development[development.length - 1].kickoff
        }`
      );
    }

    console.log(
      `Holdout pertama         : ${holdout[0].kickoff}`
    );

    console.log(
      `Holdout terakhir        : ${
        holdout[holdout.length - 1].kickoff
      }`
    );

    const holdoutResults =
      evaluateMatches(
        holdout,
        matches
      );

    printTable(holdoutResults);

    for (const model of [
      "V0.2",
      "V0.4",
      "60:40",
    ]) {
      combinedAll[model].push(
        ...holdoutResults[model]
      );
    }
  }

  console.log(
    "\n=============================================="
  );

  console.log(
    "GABUNGAN HOLDOUT — EPL + LA LIGA"
  );

  console.log(
    "=============================================="
  );

  printTable(combinedAll);

  console.log(
    "\n=============================================="
  );

  console.log(
    "INTERPRETASI EXPERIMENT #15"
  );

  console.log(
    "=============================================="
  );

  console.log(
    "V0.2 = baseline statistik."
  );

  console.log(
    "V0.4 = baseline Elo."
  );

  console.log(
    "60:40 = ensemble dengan bobot yang sudah dikunci."
  );

  console.log(
    "Tidak ada pencarian bobot baru pada holdout."
  );

  console.log(
    "Semua prediksi menggunakan aturan walk-forward."
  );

  console.log(
    "Model produksi tetap tidak berubah."
  );

} catch (error) {
  console.error(
    "\nExperiment #15 gagal:"
  );

  console.error(
    error.stack || error.message
  );

  process.exitCode = 1;

} finally {
  db.close();
}
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

const ENSEMBLE_WEIGHT = {
  v02: 0.6,
  v04: 0.4,
};

// Jumlah rolling window yang diuji.
// Karena dataset kecil, kita gunakan 4 window.
const WINDOW_COUNT = 4;

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

  const predicted = predictedResult(
    prediction
  );

  const actualHome =
    Number(match.home_score);

  const actualAway =
    Number(match.away_score);

  const exact =
    Math.round(prediction.homeGoals) ===
      actualHome &&
    Math.round(prediction.awayGoals) ===
      actualAway;

  const brier =
    (
      Math.pow(
        prediction.homeProb -
          (actual === "H" ? 1 : 0),
        2
      ) +
      Math.pow(
        prediction.drawProb -
          (actual === "D" ? 1 : 0),
        2
      ) +
      Math.pow(
        prediction.awayProb -
          (actual === "A" ? 1 : 0),
        2
      )
    ) / 3;

  return {
    correct:
      predicted === actual ? 1 : 0,

    exact:
      exact ? 1 : 0,

    goalError:
      (
        Math.abs(
          prediction.homeGoals -
            actualHome
        ) +
        Math.abs(
          prediction.awayGoals -
            actualAway
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

  const totals =
    rows.reduce(
      (sum, row) => ({
        correct:
          sum.correct +
          row.correct,

        exact:
          sum.exact +
          row.exact,

        goalError:
          sum.goalError +
          row.goalError,

        brier:
          sum.brier +
          row.brier,
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
      (
        totals.correct /
        rows.length
      ) * 100,

    exact:
      (
        totals.exact /
        rows.length
      ) * 100,

    goalMAE:
      totals.goalError /
      rows.length,

    brier:
      totals.brier /
      rows.length,
  };
}

function printTable(results) {
  console.log(
    "\nModel          Tes   Akurasi   Exact    Goal MAE   Brier"
  );

  console.log(
    "------------------------------------------------------------"
  );

  for (
    const [model, rows]
    of Object.entries(results)
  ) {
    const stats =
      summarize(rows);

    console.log(
      `${model.padEnd(14)}` +
      `${String(
        stats.tests
      ).padStart(3)}   ` +
      `${stats.accuracy
        .toFixed(2)
        .padStart(7)}%   ` +
      `${stats.exact
        .toFixed(2)
        .padStart(6)}%   ` +
      `${stats.goalMAE
        .toFixed(4)
        .padStart(8)}   ` +
      `${stats.brier
        .toFixed(4)
        .padStart(7)}`
    );
  }
}

function prepareEligible(
  matches,
  competition
) {
  const competitionMatches =
    matches
      .filter(
        (match) =>
          match.competition ===
          competition
      )
      .sort(
        (a, b) =>
          new Date(a.kickoff) -
          new Date(b.kickoff)
      );

  const eligible = [];

  for (
    const match
    of competitionMatches
  ) {
    const kickoff =
      new Date(
        match.kickoff
      ).getTime();

    const previous =
      competitionMatches.filter(
        (prior) =>
          new Date(
            prior.kickoff
          ).getTime() <
          kickoff
      );

    if (
      previous.length >=
      THRESHOLD
    ) {
      eligible.push(match);
    }
  }

  return {
    competitionMatches,
    eligible,
  };
}

function evaluateWindow(
  windowMatches,
  allMatches
) {
  const results = {
    "V0.2": [],
    "V0.4": [],
    "60:40": [],
  };

  for (
    const match
    of windowMatches
  ) {
    const kickoff =
      new Date(
        match.kickoff
      ).getTime();

    // STRICT WALK-FORWARD:
    // hanya data sebelum pertandingan target.
    const previous =
      allMatches.filter(
        (prior) =>
          new Date(
            prior.kickoff
          ).getTime() <
          kickoff
      );

    const v02 =
      predictV02(
        match,
        previous
      );

    const v04 =
      predictV04(
        match,
        previous
      );

    const ensemble =
      combinePredictions(
        v02,
        v04
      );

    results["V0.2"].push(
      evaluate(
        v02,
        match
      )
    );

    results["V0.4"].push(
      evaluate(
        v04,
        match
      )
    );

    results["60:40"].push(
      evaluate(
        ensemble,
        match
      )
    );
  }

  return results;
}

function createWindows(
  eligible
) {
  const total =
    eligible.length;

  const windowSize =
    Math.floor(
      total / WINDOW_COUNT
    );

  const windows = [];

  for (
    let i = 0;
    i < WINDOW_COUNT;
    i++
  ) {
    const start =
      i * windowSize;

    const end =
      i === WINDOW_COUNT - 1
        ? total
        : (i + 1) *
          windowSize;

    const window =
      eligible.slice(
        start,
        end
      );

    if (window.length) {
      windows.push({
        number: i + 1,
        matches: window,
      });
    }
  }

  return windows;
}

function printWindowHeader(
  competition,
  window
) {
  const first =
    window.matches[0];

  const last =
    window.matches[
      window.matches.length - 1
    ];

  console.log(
    "\n=============================================="
  );

  console.log(
    `${competition} — ROLLING WINDOW ${window.number}`
  );

  console.log(
    "=============================================="
  );

  console.log(
    `Jumlah test : ${window.matches.length}`
  );

  console.log(
    `Pertama     : ${first.kickoff}`
  );

  console.log(
    `Terakhir    : ${last.kickoff}`
  );
}

try {
  const matches =
    db
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
    "EXPERIMENT #17 — ROLLING TEMPORAL VALIDATION"
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
    `Rolling windows             : ${WINDOW_COUNT}`
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

  const windowSummaries = [];

  for (
    const competition
    of competitions
  ) {
    const {
      competitionMatches,
      eligible,
    } =
      prepareEligible(
        matches,
        competition
      );

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
      `Total selesai       : ${competitionMatches.length}`
    );

    console.log(
      `Eligible threshold  : ${eligible.length}`
    );

    if (
      eligible.length <
      WINDOW_COUNT
    ) {
      console.log(
        "Data terlalu sedikit untuk rolling windows."
      );

      continue;
    }

    const windows =
      createWindows(
        eligible
      );

    for (
      const window
      of windows
    ) {
      printWindowHeader(
        competition,
        window
      );

      const results =
        evaluateWindow(
          window.matches,
          matches
        );

      printTable(
        results
      );

      for (
        const model of [
          "V0.2",
          "V0.4",
          "60:40",
        ]
      ) {
        combinedAll[model].push(
          ...results[model]
        );

        const stats =
          summarize(
            results[model]
          );

        windowSummaries.push({
          competition,
          window:
            window.number,
          model,
          ...stats,
        });
      }
    }
  }

  console.log(
    "\n=============================================="
  );

  console.log(
    "GABUNGAN SEMUA ROLLING WINDOWS"
  );

  console.log(
    "=============================================="
  );

  printTable(
    combinedAll
  );

  console.log(
    "\n=============================================="
  );

  console.log(
    "STABILITAS AKURASI PER WINDOW"
  );

  console.log(
    "=============================================="
  );

  console.log(
    "Kompetisi       Window   V0.2      V0.4      60:40"
  );

  console.log(
    "------------------------------------------------------------"
  );

  for (
    const competition
    of competitions
  ) {
    for (
      let window = 1;
      window <= WINDOW_COUNT;
      window++
    ) {
      const v02 =
        windowSummaries.find(
          (row) =>
            row.competition ===
              competition &&
            row.window ===
              window &&
            row.model ===
              "V0.2"
        );

      const v04 =
        windowSummaries.find(
          (row) =>
            row.competition ===
              competition &&
            row.window ===
              window &&
            row.model ===
              "V0.4"
        );

      const ensemble =
        windowSummaries.find(
          (row) =>
            row.competition ===
              competition &&
            row.window ===
              window &&
            row.model ===
              "60:40"
        );

      if (
        !v02 ||
        !v04 ||
        !ensemble
      ) {
        continue;
      }

      console.log(
        `${competition.padEnd(16)}` +
        `${String(window).padStart(6)}   ` +
        `${v02.accuracy
          .toFixed(2)
          .padStart(7)}%   ` +
        `${v04.accuracy
          .toFixed(2)
          .padStart(7)}%   ` +
        `${ensemble.accuracy
          .toFixed(2)
          .padStart(7)}%`
      );
    }
  }

  console.log(
    "\n=============================================="
  );

  console.log(
    "STABILITAS GOAL MAE PER WINDOW"
  );

  console.log(
    "=============================================="
  );

  console.log(
    "Kompetisi       Window   V0.2      V0.4      60:40"
  );

  console.log(
    "------------------------------------------------------------"
  );

  for (
    const competition
    of competitions
  ) {
    for (
      let window = 1;
      window <= WINDOW_COUNT;
      window++
    ) {
      const v02 =
        windowSummaries.find(
          (row) =>
            row.competition ===
              competition &&
            row.window ===
              window &&
            row.model ===
              "V0.2"
        );

      const v04 =
        windowSummaries.find(
          (row) =>
            row.competition ===
              competition &&
            row.window ===
              window &&
            row.model ===
              "V0.4"
        );

      const ensemble =
        windowSummaries.find(
          (row) =>
            row.competition ===
              competition &&
            row.window ===
              window &&
            row.model ===
              "60:40"
        );

      if (
        !v02 ||
        !v04 ||
        !ensemble
      ) {
        continue;
      }

      console.log(
        `${competition.padEnd(16)}` +
        `${String(window).padStart(6)}   ` +
        `${v02.goalMAE
          .toFixed(4)
          .padStart(7)}   ` +
        `${v04.goalMAE
          .toFixed(4)
          .padStart(7)}   ` +
        `${ensemble.goalMAE
          .toFixed(4)
          .padStart(7)}`
      );
    }
  }

  console.log(
    "\n=============================================="
  );

  console.log(
    "STABILITAS BRIER PER WINDOW"
  );

  console.log(
    "=============================================="
  );

  console.log(
    "Kompetisi       Window   V0.2      V0.4      60:40"
  );

  console.log(
    "------------------------------------------------------------"
  );

  for (
    const competition
    of competitions
  ) {
    for (
      let window = 1;
      window <= WINDOW_COUNT;
      window++
    ) {
      const v02 =
        windowSummaries.find(
          (row) =>
            row.competition ===
              competition &&
            row.window ===
              window &&
            row.model ===
              "V0.2"
        );

      const v04 =
        windowSummaries.find(
          (row) =>
            row.competition ===
              competition &&
            row.window ===
              window &&
            row.model ===
              "V0.4"
        );

      const ensemble =
        windowSummaries.find(
          (row) =>
            row.competition ===
              competition &&
            row.window ===
              window &&
            row.model ===
              "60:40"
        );

      if (
        !v02 ||
        !v04 ||
        !ensemble
      ) {
        continue;
      }

      console.log(
        `${competition.padEnd(16)}` +
        `${String(window).padStart(6)}   ` +
        `${v02.brier
          .toFixed(4)
          .padStart(7)}   ` +
        `${v04.brier
          .toFixed(4)
          .padStart(7)}   ` +
        `${ensemble.brier
          .toFixed(4)
          .padStart(7)}`
      );
    }
  }

  console.log(
    "\n=============================================="
  );

  console.log(
    "INTERPRETASI EXPERIMENT #17"
  );

  console.log(
    "=============================================="
  );

  console.log(
    "Rolling validation digunakan untuk mengecek kestabilan model sepanjang waktu."
  );

  console.log(
    "Tidak ada pencarian bobot baru."
  );

  console.log(
    "Bobot 60:40 tetap dikunci."
  );

  console.log(
    "Semua prediksi menggunakan walk-forward."
  );

  console.log(
    "Database tetap READ ONLY."
  );

  console.log(
    "Model produksi tetap UNCHANGED."
  );

} catch (error) {
  console.error(
    "\nExperiment #17 gagal:"
  );

  console.error(
    error.stack ||
      error.message
  );

  process.exitCode = 1;

} finally {
  db.close();
}
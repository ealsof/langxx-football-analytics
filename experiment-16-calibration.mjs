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

const HOLDOUT_RATIO = 0.4;

/*
  -------------------------------------------------------
  EXPERIMENT #16
  PROBABILITY CALIBRATION

  Tujuan:
  Menguji apakah probabilitas 1X2 yang dihasilkan model
  sudah cukup terkalibrasi.

  Model:
  - V0.2
  - V0.4
  - Ensemble 60:40

  Tidak ada training ulang.
  Tidak ada pencarian bobot baru.
  Production model tidak diubah.
  Database READ ONLY.
  -------------------------------------------------------
*/

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

function getActualVector(match) {
  const actual = actualResult(
    Number(match.home_score),
    Number(match.away_score)
  );

  return {
    H: actual === "H" ? 1 : 0,
    D: actual === "D" ? 1 : 0,
    A: actual === "A" ? 1 : 0,
  };
}

function getConfidence(prediction) {
  return Math.max(
    prediction.homeProb,
    prediction.drawProb,
    prediction.awayProb
  );
}

function getPredictedClass(prediction) {
  return predictedResult(prediction);
}

function calculateBrier(prediction, actualVector) {
  return (
    Math.pow(
      prediction.homeProb - actualVector.H,
      2
    ) +
    Math.pow(
      prediction.drawProb - actualVector.D,
      2
    ) +
    Math.pow(
      prediction.awayProb - actualVector.A,
      2
    )
  ) / 3;
}

function getBucketIndex(probability) {
  if (probability >= 0.9) return 8;
  if (probability >= 0.8) return 7;
  if (probability >= 0.7) return 6;
  if (probability >= 0.6) return 5;
  if (probability >= 0.5) return 4;
  if (probability >= 0.4) return 3;
  if (probability >= 0.3) return 2;
  if (probability >= 0.2) return 1;
  return 0;
}

function bucketLabel(index) {
  const lower = index / 10;
  const upper = (index + 1) / 10;

  return `${Math.round(lower * 100)}-${Math.round(
    upper * 100
  )}%`;
}

function calculateCalibration(rows) {
  if (!rows.length) {
    return {
      tests: 0,
      accuracy: 0,
      brier: 0,
      ece: 0,
      mce: 0,
      buckets: [],
    };
  }

  const buckets = Array.from(
    { length: 9 },
    (_, index) => ({
      index,
      label: bucketLabel(index),
      count: 0,
      correct: 0,
      probabilitySum: 0,
    })
  );

  let totalCorrect = 0;
  let totalBrier = 0;

  for (const row of rows) {
    totalCorrect += row.correct;
    totalBrier += row.brier;

    const bucketIndex =
      getBucketIndex(row.confidence);

    const bucket =
      buckets[bucketIndex];

    bucket.count += 1;
    bucket.correct += row.correct;
    bucket.probabilitySum += row.confidence;
  }

  let ece = 0;
  let mce = 0;

  for (const bucket of buckets) {
    if (bucket.count === 0) {
      continue;
    }

    const averageConfidence =
      bucket.probabilitySum /
      bucket.count;

    const accuracy =
      bucket.correct /
      bucket.count;

    const absoluteGap =
      Math.abs(
        averageConfidence - accuracy
      );

    const weight =
      bucket.count /
      rows.length;

    ece += weight * absoluteGap;

    mce = Math.max(
      mce,
      absoluteGap
    );

    bucket.averageConfidence =
      averageConfidence;

    bucket.accuracy =
      accuracy;

    bucket.gap =
      absoluteGap;
  }

  return {
    tests: rows.length,

    accuracy:
      totalCorrect /
      rows.length *
      100,

    brier:
      totalBrier /
      rows.length,

    ece,

    mce,

    buckets,
  };
}

function printCalibrationTable(
  model,
  rows
) {
  const stats =
    calculateCalibration(rows);

  console.log(
    `\n${model}`
  );

  console.log(
    "------------------------------------------------------------"
  );

  console.log(
    `Tests       : ${stats.tests}`
  );

  console.log(
    `Accuracy    : ${stats.accuracy.toFixed(2)}%`
  );

  console.log(
    `Brier       : ${stats.brier.toFixed(4)}`
  );

  console.log(
    `ECE         : ${stats.ece.toFixed(4)}`
  );

  console.log(
    `MCE         : ${stats.mce.toFixed(4)}`
  );

  console.log(
    "\nConfidence Bucket"
  );

  console.log(
    "Bucket       N     Avg Conf    Accuracy    Gap"
  );

  console.log(
    "------------------------------------------------------------"
  );

  for (const bucket of stats.buckets) {
    if (bucket.count === 0) {
      continue;
    }

    console.log(
      `${bucket.label.padEnd(11)}` +
      `${String(bucket.count).padStart(3)}   ` +
      `${(
        bucket.averageConfidence * 100
      ).toFixed(2).padStart(8)}%   ` +
      `${(
        bucket.accuracy * 100
      ).toFixed(2).padStart(8)}%   ` +
      `${(
        bucket.gap * 100
      ).toFixed(2).padStart(7)}%`
    );
  }
}

function printSummary(
  results
) {
  console.log(
    "\nModel          Tes   Akurasi   Brier     ECE       MCE"
  );

  console.log(
    "----------------------------------------------------------------"
  );

  for (
    const [model, rows]
    of Object.entries(results)
  ) {
    const stats =
      calculateCalibration(rows);

    console.log(
      `${model.padEnd(14)}` +
      `${String(stats.tests).padStart(3)}   ` +
      `${stats.accuracy
        .toFixed(2)
        .padStart(7)}%   ` +
      `${stats.brier
        .toFixed(4)
        .padStart(7)}   ` +
      `${stats.ece
        .toFixed(4)
        .padStart(7)}   ` +
      `${stats.mce
        .toFixed(4)
        .padStart(7)}`
    );
  }
}

function prepareCompetitionData(
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
    const kickoffTime =
      new Date(
        match.kickoff
      ).getTime();

    const previous =
      competitionMatches.filter(
        (prior) =>
          new Date(
            prior.kickoff
          ).getTime() <
          kickoffTime
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

function evaluateMatches(
  matches,
  allMatches
) {
  const results = {
    "V0.2": [],
    "V0.4": [],
    "60:40": [],
  };

  for (
    const match
    of matches
  ) {
    const kickoffTime =
      new Date(
        match.kickoff
      ).getTime();

    /*
      Hanya pertandingan yang sudah
      terjadi sebelum target yang boleh
      digunakan sebagai informasi.
    */
    const previous =
      allMatches.filter(
        (prior) =>
          new Date(
            prior.kickoff
          ).getTime() <
          kickoffTime
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

    const actualVector =
      getActualVector(match);

    const predictions = {
      "V0.2": v02,
      "V0.4": v04,
      "60:40": ensemble,
    };

    for (
      const [model, prediction]
      of Object.entries(
        predictions
      )
    ) {
      const predicted =
        getPredictedClass(
          prediction
        );

      const actual =
        actualResult(
          Number(
            match.home_score
          ),
          Number(
            match.away_score
          )
        );

      results[model].push({
        correct:
          predicted === actual
            ? 1
            : 0,

        confidence:
          getConfidence(
            prediction
          ),

        predictedClass:
          predicted,

        actual,

        brier:
          calculateBrier(
            prediction,
            actualVector
          ),
      });
    }
  }

  return results;
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
    "EXPERIMENT #16 — PROBABILITY CALIBRATION"
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

  for (
    const competition
    of competitions
  ) {
    const {
      competitionMatches,
      eligible,
    } =
      prepareCompetitionData(
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
          eligible.length *
          HOLDOUT_RATIO
        )
      );

    const holdoutStart =
      eligible.length -
      holdoutCount;

    const development =
      eligible.slice(
        0,
        holdoutStart
      );

    const holdout =
      eligible.slice(
        holdoutStart
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
          development[
            development.length - 1
          ].kickoff
        }`
      );
    }

    console.log(
      `Holdout pertama         : ${holdout[0].kickoff}`
    );

    console.log(
      `Holdout terakhir        : ${
        holdout[
          holdout.length - 1
        ].kickoff
      }`
    );

    const holdoutResults =
      evaluateMatches(
        holdout,
        matches
      );

    console.log(
      "\n=============================================="
    );

    console.log(
      `CALIBRATION — ${competition}`
    );

    console.log(
      "=============================================="
    );

    for (
      const model of [
        "V0.2",
        "V0.4",
        "60:40",
      ]
    ) {
      printCalibrationTable(
        model,
        holdoutResults[model]
      );
    }

    console.log(
      "\nRingkasan kompetisi:"
    );

    printSummary(
      holdoutResults
    );

    for (
      const model of [
        "V0.2",
        "V0.4",
        "60:40",
      ]
    ) {
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

  printSummary(
    combinedAll
  );

  console.log(
    "\n=============================================="
  );

  console.log(
    "CALIBRATION DETAIL — GABUNGAN"
  );

  console.log(
    "=============================================="
  );

  for (
    const model of [
      "V0.2",
      "V0.4",
      "60:40",
    ]
  ) {
    printCalibrationTable(
      model,
      combinedAll[model]
    );
  }

  console.log(
    "\n=============================================="
  );

  console.log(
    "INTERPRETASI EXPERIMENT #16"
  );

  console.log(
    "=============================================="
  );

  console.log(
    "ECE semakin kecil = probabilitas semakin terkalibrasi."
  );

  console.log(
    "MCE semakin kecil = gap terburuk semakin kecil."
  );

  console.log(
    "Brier semakin kecil = kualitas probabilitas semakin baik."
  );

  console.log(
    "Akurasi tetap dilaporkan sebagai metrik pendukung."
  );

  console.log(
    "Tidak ada perubahan bobot ensemble."
  );

  console.log(
    "Tidak ada perubahan model produksi."
  );

} catch (error) {
  console.error(
    "\nExperiment #16 gagal:"
  );

  console.error(
    error.stack ||
    error.message
  );

  process.exitCode = 1;

} finally {
  db.close();
}
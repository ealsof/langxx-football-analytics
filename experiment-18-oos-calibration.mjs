import Database from "better-sqlite3";
import {
  actualResult,
  predictedResult,
  predictV02,
  predictV04
} from "./evaluation-models.mjs";

const db = new Database("football.db", { readonly: true });

const THRESHOLD = 30;
const CALIBRATION_RATIO = 0.60;
const ENSEMBLE_V02_WEIGHT = 0.60;
const ENSEMBLE_V04_WEIGHT = 0.40;

// ============================================================
// HELPERS
// ============================================================

function poisson(lambda, k) {
  let factorial = 1;

  for (let i = 2; i <= k; i++) {
    factorial *= i;
  }

  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial;
}

function poissonPrediction(homeGoals, awayGoals) {
  const maxGoals = 10;

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const probability =
        poisson(homeGoals, h) * poisson(awayGoals, a);

      if (h > a) homeWin += probability;
      else if (h === a) draw += probability;
      else awayWin += probability;
    }
  }

  const total = homeWin + draw + awayWin;

  return {
    homeProb: homeWin / total,
    drawProb: draw / total,
    awayProb: awayWin / total,
    expectedHomeGoals: homeGoals,
    expectedAwayGoals: awayGoals
  };
}

function predictV02Local(home, away, league) {
  const homeAttack =
    home.goalsFor /
    Math.max(league.homeGoals * home.games, 0.1);

  const awayAttack =
    away.goalsFor /
    Math.max(league.awayGoals * away.games, 0.1);

  const homeDefense =
    home.goalsAgainst /
    Math.max(league.awayGoals * home.games, 0.1);

  const awayDefense =
    away.goalsAgainst /
    Math.max(league.homeGoals * away.games, 0.1);

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

  return poissonPrediction(homeGoals, awayGoals);
}

function predictV04Local(homeRating, awayRating, league) {
  const difference =
    homeRating + 60 - awayRating;

  let homeFactor =
    1 + difference / 1000;

  let awayFactor =
    1 - difference / 1200;

  homeFactor = Math.max(
    0.65,
    Math.min(homeFactor, 1.35)
  );

  awayFactor = Math.max(
    0.65,
    Math.min(awayFactor, 1.35)
  );

  let homeGoals =
    league.homeGoals * homeFactor;

  let awayGoals =
    league.awayGoals * awayFactor;

  homeGoals = Math.max(
    0.2,
    Math.min(homeGoals, 4.5)
  );

  awayGoals = Math.max(
    0.2,
    Math.min(awayGoals, 4.5)
  );

  return poissonPrediction(homeGoals, awayGoals);
}

function eloExpected(ratingA, ratingB) {
  return 1 / (
    1 +
    Math.pow(10, (ratingB - ratingA) / 400)
  );
}

function buildV04Ratings(matches) {
  const ratings = new Map();

  for (const match of matches) {
    if (!ratings.has(match.home_team)) {
      ratings.set(match.home_team, 1500);
    }

    if (!ratings.has(match.away_team)) {
      ratings.set(match.away_team, 1500);
    }

    match.homeRating =
      ratings.get(match.home_team);

    match.awayRating =
      ratings.get(match.away_team);

    const expectedHome =
      eloExpected(
        match.homeRating + 60,
        match.awayRating
      );

    const actualHome =
      match.home_score > match.away_score
        ? 1
        : match.home_score === match.away_score
          ? 0.5
          : 0;

    const margin =
      Math.abs(
        match.home_score -
        match.away_score
      );

    let marginMultiplier = 1;

    if (margin === 2) {
      marginMultiplier = 1.25;
    } else if (margin >= 3) {
      marginMultiplier = 1.5;
    }

    const k = 25 * marginMultiplier;

    const delta =
      k *
      (actualHome - expectedHome);

    ratings.set(
      match.home_team,
      match.homeRating + delta
    );

    ratings.set(
      match.away_team,
      match.awayRating - delta
    );
  }

  return matches;
}

function getLeagueStats(matches) {
  const totalHomeGoals =
    matches.reduce(
      (sum, m) => sum + m.home_score,
      0
    );

  const totalAwayGoals =
    matches.reduce(
      (sum, m) => sum + m.away_score,
      0
    );

  const games = matches.length;

  return {
    homeGoals:
      totalHomeGoals / Math.max(games, 1),

    awayGoals:
      totalAwayGoals / Math.max(games, 1),

    games
  };
}

function getTeamStats(matches, team) {
  let goalsFor = 0;
  let goalsAgainst = 0;
  let games = 0;

  for (const match of matches) {
    if (match.home_team === team) {
      goalsFor += match.home_score;
      goalsAgainst += match.away_score;
      games++;
    }

    if (match.away_team === team) {
      goalsFor += match.away_score;
      goalsAgainst += match.home_score;
      games++;
    }
  }

  return {
    goalsFor,
    goalsAgainst,
    games
  };
}

// ============================================================
// BUILD PREDICTION
// ============================================================

function createPrediction(
  model,
  target,
  history
) {
  const league = getLeagueStats(history);

  if (model === "V0.2") {
    const home = getTeamStats(
      history,
      target.home_team
    );

    const away = getTeamStats(
      history,
      target.away_team
    );

    return predictV02Local(
      home,
      away,
      league
    );
  }

  if (model === "V0.4") {
    const historyWithRatings =
      history.map(match => ({
        ...match
      }));

    buildV04Ratings(historyWithRatings);

    const lastHome =
      [...historyWithRatings]
        .reverse()
        .find(
          m =>
            m.home_team === target.home_team ||
            m.away_team === target.home_team
        );

    const lastAway =
      [...historyWithRatings]
        .reverse()
        .find(
          m =>
            m.home_team === target.away_team ||
            m.away_team === target.away_team
        );

    const homeRating =
      lastHome
        ? (
            lastHome.home_team === target.home_team
              ? lastHome.homeRating
              : lastHome.awayRating
          )
        : 1500;

    const awayRating =
      lastAway
        ? (
            lastAway.home_team === target.away_team
              ? lastAway.homeRating
              : lastAway.awayRating
          )
        : 1500;

    return predictV04Local(
      homeRating,
      awayRating,
      league
    );
  }

  throw new Error(
    `Unknown model: ${model}`
  );
}

function ensemblePrediction(v02, v04) {
  return {
    homeProb:
      ENSEMBLE_V02_WEIGHT * v02.homeProb +
      ENSEMBLE_V04_WEIGHT * v04.homeProb,

    drawProb:
      ENSEMBLE_V02_WEIGHT * v02.drawProb +
      ENSEMBLE_V04_WEIGHT * v04.drawProb,

    awayProb:
      ENSEMBLE_V02_WEIGHT * v02.awayProb +
      ENSEMBLE_V04_WEIGHT * v04.awayProb,

    expectedHomeGoals:
      ENSEMBLE_V02_WEIGHT * v02.expectedHomeGoals +
      ENSEMBLE_V04_WEIGHT * v04.expectedHomeGoals,

    expectedAwayGoals:
      ENSEMBLE_V02_WEIGHT * v02.expectedAwayGoals +
      ENSEMBLE_V04_WEIGHT * v04.expectedAwayGoals
  };
}

// ============================================================
// CALIBRATION
// ============================================================

// Shrink probabilities toward uniform distribution.
//
// alpha = 1.00
// -> raw probability
//
// alpha = 0.50
// -> halfway between raw and uniform
//
// alpha = 0.10
// -> heavily shrunk toward 33.3% each
function calibratePrediction(prediction, alpha) {
  const uniform = 1 / 3;

  return {
    ...prediction,

    homeProb:
      alpha * prediction.homeProb +
      (1 - alpha) * uniform,

    drawProb:
      alpha * prediction.drawProb +
      (1 - alpha) * uniform,

    awayProb:
      alpha * prediction.awayProb +
      (1 - alpha) * uniform
  };
}

// ============================================================
// METRICS
// ============================================================

function brierScore(prediction, actual) {
  const actualVector = {
    H: actual === "H" ? 1 : 0,
    D: actual === "D" ? 1 : 0,
    A: actual === "A" ? 1 : 0
  };

  const error =
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
    );

  return error / 3;
}

function goalMAE(prediction, target) {
  return (
    Math.abs(
      prediction.expectedHomeGoals -
      target.home_score
    ) +
    Math.abs(
      prediction.expectedAwayGoals -
      target.away_score
    )
  ) / 2;
}

function calculateECE(rows) {
  if (rows.length === 0) return 0;

  const buckets = [
    { min: 0.2, max: 0.3 },
    { min: 0.3, max: 0.4 },
    { min: 0.4, max: 0.5 },
    { min: 0.5, max: 0.6 },
    { min: 0.6, max: 0.7 },
    { min: 0.7, max: 0.8 },
    { min: 0.8, max: 0.9 },
    { min: 0.9, max: 1.01 }
  ];

  let ece = 0;

  for (const bucket of buckets) {
    const bucketRows = rows.filter(row => {
      const confidence =
        Math.max(
          row.prediction.homeProb,
          row.prediction.drawProb,
          row.prediction.awayProb
        );

      return (
        confidence >= bucket.min &&
        confidence < bucket.max
      );
    });

    if (bucketRows.length === 0) continue;

    const avgConfidence =
      bucketRows.reduce((sum, row) => {
        return (
          sum +
          Math.max(
            row.prediction.homeProb,
            row.prediction.drawProb,
            row.prediction.awayProb
          )
        );
      }, 0) / bucketRows.length;

    const accuracy =
      bucketRows.reduce((sum, row) => {
        return (
          sum +
          (
            predictedResult(row.prediction) ===
            row.actual
              ? 1
              : 0
          )
        );
      }, 0) / bucketRows.length;

    ece +=
      (
        bucketRows.length /
        rows.length
      ) *
      Math.abs(
        avgConfidence - accuracy
      );
  }

  return ece;
}

function calculateMCE(rows) {
  if (rows.length === 0) return 0;

  const buckets = [
    { min: 0.2, max: 0.3 },
    { min: 0.3, max: 0.4 },
    { min: 0.4, max: 0.5 },
    { min: 0.5, max: 0.6 },
    { min: 0.6, max: 0.7 },
    { min: 0.7, max: 0.8 },
    { min: 0.8, max: 0.9 },
    { min: 0.9, max: 1.01 }
  ];

  let maxGap = 0;

  for (const bucket of buckets) {
    const bucketRows = rows.filter(row => {
      const confidence =
        Math.max(
          row.prediction.homeProb,
          row.prediction.drawProb,
          row.prediction.awayProb
        );

      return (
        confidence >= bucket.min &&
        confidence < bucket.max
      );
    });

    if (bucketRows.length === 0) continue;

    const avgConfidence =
      bucketRows.reduce((sum, row) => {
        return (
          sum +
          Math.max(
            row.prediction.homeProb,
            row.prediction.drawProb,
            row.prediction.awayProb
          )
        );
      }, 0) / bucketRows.length;

    const accuracy =
      bucketRows.reduce((sum, row) => {
        return (
          sum +
          (
            predictedResult(row.prediction) ===
            row.actual
              ? 1
              : 0
          )
        );
      }, 0) / bucketRows.length;

    maxGap = Math.max(
      maxGap,
      Math.abs(
        avgConfidence - accuracy
      )
    );
  }

  return maxGap;
}

function calculateMetrics(rows) {
  if (rows.length === 0) {
    return {
      n: 0,
      accuracy: 0,
      exact: 0,
      mae: 0,
      brier: 0,
      ece: 0,
      mce: 0
    };
  }

  let correct = 0;
  let exact = 0;
  let mae = 0;
  let brier = 0;

  for (const row of rows) {
    const predicted =
      predictedResult(row.prediction);

    if (predicted === row.actual) {
      correct++;
    }

    const predictedHome =
      Math.round(
        row.prediction.expectedHomeGoals
      );

    const predictedAway =
      Math.round(
        row.prediction.expectedAwayGoals
      );

    if (
      predictedHome === row.target.home_score &&
      predictedAway === row.target.away_score
    ) {
      exact++;
    }

    mae += goalMAE(
      row.prediction,
      row.target
    );

    brier += brierScore(
      row.prediction,
      row.actual
    );
  }

  return {
    n: rows.length,

    accuracy:
      (correct / rows.length) * 100,

    exact:
      (exact / rows.length) * 100,

    mae:
      mae / rows.length,

    brier:
      brier / rows.length,

    ece:
      calculateECE(rows),

    mce:
      calculateMCE(rows)
  };
}

// ============================================================
// LEARN CALIBRATION ALPHA
// ============================================================

function learnAlpha(rows) {
  let bestAlpha = 1;
  let bestBrier = Infinity;

  // Avoid alpha = 0 because completely uniform
  // probabilities destroy meaningful class ordering.
  for (
    let alpha = 0.01;
    alpha <= 1.0001;
    alpha += 0.01
  ) {
    const calibratedRows =
      rows.map(row => ({
        ...row,
        prediction:
          calibratePrediction(
            row.prediction,
            alpha
          )
      }));

    const metrics =
      calculateMetrics(
        calibratedRows
      );

    if (
      metrics.brier <
      bestBrier
    ) {
      bestBrier = metrics.brier;
      bestAlpha =
        Number(alpha.toFixed(2));
    }
  }

  return {
    alpha: bestAlpha,
    calibrationBrier: bestBrier
  };
}

// ============================================================
// LOAD DATA
// ============================================================

const matches = db.prepare(`
  SELECT
    id,
    competition,
    kickoff,
    home_team,
    away_team,
    home_score,
    away_score,
    status
  FROM matches
  WHERE LOWER(status) = 'finished'
    AND home_score IS NOT NULL
    AND away_score IS NOT NULL
    AND kickoff IS NOT NULL
  ORDER BY kickoff ASC
`).all();

const competitions = [
  "Premier League",
  "La Liga"
];

const models = [
  "V0.2",
  "V0.4",
  "60:40"
];

// ============================================================
// RUN OOS CALIBRATION
// ============================================================

const allResults = [];

for (const competition of competitions) {
  const competitionMatches =
    matches.filter(
      match =>
        match.competition === competition
    );

  if (
    competitionMatches.length <= THRESHOLD
  ) {
    continue;
  }

  const rows = [];

  for (
    let i = THRESHOLD;
    i < competitionMatches.length;
    i++
  ) {
    const target =
      competitionMatches[i];

    const history =
      competitionMatches
        .slice(0, i);

    if (
      history.length < THRESHOLD
    ) {
      continue;
    }

    const v02 =
      createPrediction(
        "V0.2",
        target,
        history
      );

    const v04 =
      createPrediction(
        "V0.4",
        target,
        history
      );

    const ensemble =
      ensemblePrediction(
        v02,
        v04
      );

    rows.push({
      target,
      actual:
        actualResult(
          target.home_score,
          target.away_score
        ),

      predictions: {
        "V0.2": v02,
        "V0.4": v04,
        "60:40": ensemble
      }
    });
  }

  const splitIndex =
    Math.floor(
      rows.length *
      CALIBRATION_RATIO
    );

  const calibrationRows =
    rows.slice(0, splitIndex);

  const validationRows =
    rows.slice(splitIndex);

  console.log("\n====================================");
  console.log(
    `COMPETITION: ${competition}`
  );
  console.log("====================================");

  console.log(
    `Eligible rows      : ${rows.length}`
  );

  console.log(
    `Calibration rows   : ${calibrationRows.length}`
  );

  console.log(
    `Validation rows    : ${validationRows.length}`
  );

  console.log(
    `Calibration ratio  : ${CALIBRATION_RATIO * 100}%`
  );

  if (calibrationRows.length > 0) {
    console.log(
      `Calibration period : ${calibrationRows[0].target.kickoff} -> ${
        calibrationRows[
          calibrationRows.length - 1
        ].target.kickoff
      }`
    );
  }

  if (validationRows.length > 0) {
    console.log(
      `Validation period  : ${validationRows[0].target.kickoff} -> ${
        validationRows[
          validationRows.length - 1
        ].target.kickoff
      }`
    );
  }

  for (const model of models) {
    const calibrationModelRows =
      calibrationRows.map(row => ({
        target: row.target,
        actual: row.actual,
        prediction:
          row.predictions[model]
      }));

    const validationRawRows =
      validationRows.map(row => ({
        target: row.target,
        actual: row.actual,
        prediction:
          row.predictions[model]
      }));

    const learned =
      learnAlpha(
        calibrationModelRows
      );

    const validationCalibratedRows =
      validationRawRows.map(row => ({
        ...row,
        prediction:
          calibratePrediction(
            row.prediction,
            learned.alpha
          )
      }));

    const rawMetrics =
      calculateMetrics(
        validationRawRows
      );

    const calibratedMetrics =
      calculateMetrics(
        validationCalibratedRows
      );

    const result = {
      competition,
      model,
      calibrationN:
        calibrationModelRows.length,
      validationN:
        validationRawRows.length,
      alpha:
        learned.alpha,
      calibrationBrier:
        learned.calibrationBrier,
      raw: rawMetrics,
      calibrated:
        calibratedMetrics
    };

    allResults.push(result);

    console.log("\n------------------------------------");
    console.log(`MODEL: ${model}`);
    console.log("------------------------------------");

    console.log(
      `Learned alpha      : ${learned.alpha.toFixed(2)}`
    );

    console.log(
      `Calibration Brier  : ${learned.calibrationBrier.toFixed(4)}`
    );

    console.log("\nRAW VALIDATION");

    console.log(
      `Accuracy           : ${rawMetrics.accuracy.toFixed(2)}%`
    );

    console.log(
      `Exact score        : ${rawMetrics.exact.toFixed(2)}%`
    );

    console.log(
      `Goal MAE           : ${rawMetrics.mae.toFixed(4)}`
    );

    console.log(
      `Brier              : ${rawMetrics.brier.toFixed(4)}`
    );

    console.log(
      `ECE                : ${rawMetrics.ece.toFixed(4)}`
    );

    console.log(
      `MCE                : ${rawMetrics.mce.toFixed(4)}`
    );

    console.log("\nCALIBRATED VALIDATION");

    console.log(
      `Accuracy           : ${calibratedMetrics.accuracy.toFixed(2)}%`
    );

    console.log(
      `Exact score        : ${calibratedMetrics.exact.toFixed(2)}%`
    );

    console.log(
      `Goal MAE           : ${calibratedMetrics.mae.toFixed(4)}`
    );

    console.log(
      `Brier              : ${calibratedMetrics.brier.toFixed(4)}`
    );

    console.log(
      `ECE                : ${calibratedMetrics.ece.toFixed(4)}`
    );

    console.log(
      `MCE                : ${calibratedMetrics.mce.toFixed(4)}`
    );

    console.log("\nCALIBRATION EFFECT");

    console.log(
      `Brier change       : ${
        (
          calibratedMetrics.brier -
          rawMetrics.brier
        ).toFixed(4)
      }`
    );

    console.log(
      `ECE change         : ${
        (
          calibratedMetrics.ece -
          rawMetrics.ece
        ).toFixed(4)
      }`
    );

    console.log(
      `MCE change         : ${
        (
          calibratedMetrics.mce -
          rawMetrics.mce
        ).toFixed(4)
      }`
    );
  }
}

// ============================================================
// COMBINED RESULTS
// ============================================================

console.log("\n\n====================================");
console.log("COMBINED OOS CALIBRATION");
console.log("====================================");

for (const model of models) {
  const modelResults =
    allResults.filter(
      result =>
        result.model === model
    );

  const totalN =
    modelResults.reduce(
      (sum, result) =>
        sum + result.validationN,
      0
    );

  const weightedRawBrier =
    modelResults.reduce(
      (sum, result) =>
        sum +
        result.raw.brier *
        result.validationN,
      0
    ) /
    Math.max(totalN, 1);

  const weightedCalibratedBrier =
    modelResults.reduce(
      (sum, result) =>
        sum +
        result.calibrated.brier *
        result.validationN,
      0
    ) /
    Math.max(totalN, 1);

  const weightedRawECE =
    modelResults.reduce(
      (sum, result) =>
        sum +
        result.raw.ece *
        result.validationN,
      0
    ) /
    Math.max(totalN, 1);

  const weightedCalibratedECE =
    modelResults.reduce(
      (sum, result) =>
        sum +
        result.calibrated.ece *
        result.validationN,
      0
    ) /
    Math.max(totalN, 1);

  const weightedRawMCE =
    modelResults.reduce(
      (sum, result) =>
        sum +
        result.raw.mce *
        result.validationN,
      0
    ) /
    Math.max(totalN, 1);

  const weightedCalibratedMCE =
    modelResults.reduce(
      (sum, result) =>
        sum +
        result.calibrated.mce *
        result.validationN,
      0
    ) /
    Math.max(totalN, 1);

  console.log("\n------------------------------------");
  console.log(`MODEL: ${model}`);
  console.log("------------------------------------");

  console.log(
    `Validation N       : ${totalN}`
  );

  console.log(
    `Raw Brier          : ${weightedRawBrier.toFixed(4)}`
  );

  console.log(
    `Calibrated Brier   : ${weightedCalibratedBrier.toFixed(4)}`
  );

  console.log(
    `Raw ECE            : ${weightedRawECE.toFixed(4)}`
  );

  console.log(
    `Calibrated ECE     : ${weightedCalibratedECE.toFixed(4)}`
  );

  console.log(
    `Raw MCE            : ${weightedRawMCE.toFixed(4)}`
  );

  console.log(
    `Calibrated MCE     : ${weightedCalibratedMCE.toFixed(4)}`
  );

  console.log(
    `Brier improvement  : ${
      (
        weightedRawBrier -
        weightedCalibratedBrier
      ).toFixed(4)
    }`
  );

  console.log(
    `ECE improvement    : ${
      (
        weightedRawECE -
        weightedCalibratedECE
      ).toFixed(4)
    }`
  );

  console.log(
    `MCE improvement    : ${
      (
        weightedRawMCE -
        weightedCalibratedMCE
      ).toFixed(4)
    }`
  );
}

console.log("\n====================================");
console.log("EXPERIMENT #18 COMPLETE");
console.log("====================================");

console.log(
  "DB mode: READ ONLY"
);

console.log(
  "Production model: UNCHANGED"
);

console.log(
  "Calibration was learned only from earlier chronological data."
);

console.log(
  "Final validation data was not used to learn alpha."
);

db.close();
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = path.join(__dirname, 'football.db');
const SERVER_PATH = path.join(__dirname, 'server.js');

const MODEL = 'ensemble_60_40';

function section(title) {
  console.log('');
  console.log('============================================================');
  console.log(` ${title}`);
  console.log('============================================================');
  console.log('');
}

function pass(label, detail = '') {
  console.log(
    `PASS  ${label}${detail ? ` -> ${detail}` : ''}`
  );
}

function warn(label, detail = '') {
  console.log(
    `WARN  ${label}${detail ? ` -> ${detail}` : ''}`
  );
}

if (!fs.existsSync(DB_PATH)) {
  console.log('football.db tidak ditemukan.');
  process.exit(1);
}

const db = new Database(DB_PATH, {
  readonly: true,
  fileMustExist: true
});

try {
  section('FOOTBALL ANALYTICS LAB - PRODUCTION MONITOR');

  console.log(`Model monitored : ${MODEL}`);
  console.log(`Database        : ${DB_PATH}`);
  console.log(`Mode            : READ-ONLY`);
  console.log(`Current UTC     : ${new Date().toISOString()}`);
  console.log('');

  section('MATCH STATUS');

  const matchStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(
        CASE
          WHEN status='finished'
           AND home_score IS NOT NULL
           AND away_score IS NOT NULL
          THEN 1 ELSE 0
        END
      ) AS finished_scored,
      SUM(
        CASE
          WHEN kickoff > datetime('now')
          THEN 1 ELSE 0
        END
      ) AS future_matches
    FROM matches
  `).get();

  console.log(`Total matches    : ${matchStats.total}`);
  console.log(`Finished scored  : ${matchStats.finished_scored}`);
  console.log(`Future matches   : ${matchStats.future_matches}`);

  section('PREDICTION STATUS');

  const predictionStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(
        CASE
          WHEN model_version=?
          THEN 1 ELSE 0
        END
      ) AS ensemble_total,
      SUM(
        CASE
          WHEN model_version='v0.1'
          THEN 1 ELSE 0
        END
      ) AS v01_total,
      SUM(
        CASE
          WHEN model_version='v0.1-fallback'
          THEN 1 ELSE 0
        END
      ) AS fallback_total
    FROM predictions
  `).get(MODEL);

  console.log(`All predictions : ${predictionStats.total}`);
  console.log(`Ensemble        : ${predictionStats.ensemble_total}`);
  console.log(`V0.1            : ${predictionStats.v01_total}`);
  console.log(`Fallback        : ${predictionStats.fallback_total}`);

  if (Number(predictionStats.ensemble_total) > 0) {
    pass(
      'production ensemble tersedia',
      `${predictionStats.ensemble_total} prediction`
    );
  } else {
    warn(
      'production ensemble tersedia',
      'belum ada prediction ensemble'
    );
  }

  section('EVALUATION STATUS');

  const evaluationCount = db.prepare(`
    SELECT COUNT(*) AS n
    FROM evaluations e
    JOIN predictions p
      ON p.id=e.prediction_id
    WHERE p.model_version=?
  `).get(MODEL).n;

  console.log(
    `Evaluated ensemble predictions : ${evaluationCount}`
  );

  if (evaluationCount === 0) {
    console.log('');
    console.log(
      'Belum ada evaluation production.'
    );
    console.log(
      'Ini NORMAL selama belum ada prediction ensemble'
    );
    console.log(
      'yang memiliki hasil pertandingan final.'
    );
  } else {
    pass(
      'evaluation production tersedia',
      `${evaluationCount} evaluation`
    );
  }

  section('EVALUATION SAMPLE');

  if (evaluationCount > 0) {
    const evaluations = db.prepare(`
      SELECT
        e.id AS evaluation_id,
        e.prediction_id,
        e.actual_home_score,
        e.actual_away_score,
        e.actual_result,
        e.predicted_result,
        e.result_correct,
        e.absolute_error,
        e.brier_score,
        p.model_version,
        m.home_team,
        m.away_team,
        m.competition,
        m.kickoff
      FROM evaluations e
      JOIN predictions p
        ON p.id=e.prediction_id
      JOIN matches m
        ON m.id=p.match_id
      WHERE p.model_version=?
      ORDER BY e.id DESC
      LIMIT 10
    `).all(MODEL);

    for (const row of evaluations) {
      console.log(
        `${row.home_team} vs ${row.away_team}`
      );

      console.log(
        `  Competition : ${row.competition}`
      );

      console.log(
        `  Actual      : ${row.actual_home_score}-${row.actual_away_score}`
      );

      console.log(
        `  Actual res. : ${row.actual_result}`
      );

      console.log(
        `  Predicted   : ${row.predicted_result}`
      );

      console.log(
        `  Correct     : ${row.result_correct}`
      );

      console.log(
        `  Abs error   : ${row.absolute_error}`
      );

      console.log(
        `  Brier       : ${row.brier_score}`
      );

      console.log('');
    }
  }

  section('PRODUCTION METRICS');

  if (evaluationCount > 0) {
    const metrics = db.prepare(`
      SELECT
        COUNT(*) AS n,
        AVG(
          CASE
            WHEN e.result_correct=1 THEN 1.0
            ELSE 0.0
          END
        ) AS accuracy,
        AVG(e.absolute_error) AS mae,
        AVG(e.brier_score) AS brier
      FROM evaluations e
      JOIN predictions p
        ON p.id=e.prediction_id
      WHERE p.model_version=?
    `).get(MODEL);

    console.log(
      `Sample size : ${metrics.n}`
    );

    console.log(
      `Accuracy    : ${(
        Number(metrics.accuracy) * 100
      ).toFixed(2)}%`
    );

    console.log(
      `MAE         : ${Number(metrics.mae).toFixed(4)}`
    );

    console.log(
      `Brier Score : ${Number(metrics.brier).toFixed(4)}`
    );

    console.log('');

    console.log('BACKTEST REFERENCE');
    console.log('Accuracy    : 48.78%');
    console.log('MAE         : 1.1438');
    console.log('Brier Score : 0.2159');
  } else {
    console.log(
      'Belum cukup data production untuk menghitung metrics.'
    );
  }

  section('FUTURE PREDICTION SAFETY');

  const futureRows = db.prepare(`
    SELECT
      p.id,
      p.home_prob,
      p.draw_prob,
      p.away_prob,
      p.predicted_home_goals,
      p.predicted_away_goals,
      p.predicted_result,
      m.home_team,
      m.away_team,
      m.kickoff,
      m.status,
      m.home_score,
      m.away_score
    FROM predictions p
    JOIN matches m
      ON m.id=p.match_id
    WHERE p.model_version=?
      AND m.kickoff > datetime('now')
  `).all(MODEL);

  let probabilityErrors = 0;
  let goalErrors = 0;
  let suspiciousScores = 0;

  for (const row of futureRows) {
    const probabilitySum =
      Number(row.home_prob) +
      Number(row.draw_prob) +
      Number(row.away_prob);

    if (Math.abs(probabilitySum - 1) > 1e-7) {
      probabilityErrors++;
    }

    if (
      !Number.isFinite(Number(row.predicted_home_goals)) ||
      !Number.isFinite(Number(row.predicted_away_goals)) ||
      Number(row.predicted_home_goals) < 0 ||
      Number(row.predicted_away_goals) < 0
    ) {
      goalErrors++;
    }

    const hasScore =
      row.home_score !== null ||
      row.away_score !== null;

    const isPlaceholder =
      Number(row.home_score) === 0 &&
      Number(row.away_score) === 0 &&
      (
        row.status === 'timed' ||
        row.status === 'scheduled'
      );

    if (hasScore && !isPlaceholder) {
      suspiciousScores++;
    }
  }

  console.log(
    `Future ensemble predictions : ${futureRows.length}`
  );

  console.log(
    `Probability errors           : ${probabilityErrors}`
  );

  console.log(
    `Expected-goal errors         : ${goalErrors}`
  );

  console.log(
    `Suspicious future scores     : ${suspiciousScores}`
  );

  console.log('');

  if (probabilityErrors === 0) {
    pass('future probabilities aman');
  } else {
    warn(
      'future probabilities aman',
      `${probabilityErrors} error`
    );
  }

  if (goalErrors === 0) {
    pass('future expected goals aman');
  } else {
    warn(
      'future expected goals aman',
      `${goalErrors} error`
    );
  }

  if (suspiciousScores === 0) {
    pass(
      'tidak ada suspicious future score'
    );
  } else {
    warn(
      'tidak ada suspicious future score',
      `${suspiciousScores} row`
    );
  }

  section('MODEL VERSION');

  const versions = db.prepare(`
    SELECT
      version,
      status,
      accuracy,
      created_at
    FROM model_versions
    ORDER BY created_at ASC
  `).all();

  for (const version of versions) {
    console.log(
      `${version.version} | ` +
      `status=${version.status} | ` +
      `accuracy=${version.accuracy ?? 'null'}`
    );
  }

  section('MONITORING RESULT');

  console.log(
    'Model yang dimonitor : ensemble_60_40'
  );

  console.log(
    'Mode                 : production monitoring'
  );

  console.log(
    'Database             : READ-ONLY'
  );

  console.log('');

  if (evaluationCount === 0) {
    console.log(
      'STATUS: WAITING FOR PRODUCTION RESULTS'
    );

    console.log('');
    console.log(
      'Sistem siap menunggu pertandingan selesai.'
    );

    console.log(
      'Belum ada cukup data untuk menilai performa production.'
    );
  } else {
    console.log(
      'STATUS: PRODUCTION EVALUATION ACTIVE'
    );

    console.log('');
    console.log(
      `Sudah ada ${evaluationCount} evaluation production.`
    );
  }

  console.log('');
  console.log(
    'Monitor selesai. Database tidak dimodifikasi.'
  );
  console.log('');
} finally {
  db.close();
}
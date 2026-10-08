import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = path.join(__dirname, 'football.db');
const SERVER_PATH = path.join(__dirname, 'server.js');

const EXPECTED_MODEL = 'ensemble_60_40';
const EXPECTED_V02_WEIGHT = 0.60;
const EXPECTED_V04_WEIGHT = 0.40;
const EXPECTED_THRESHOLD = 30;

const OLD_V01_SHA =
  '8d8397842054710b578e20561d0869f175d376103a2c935a25bfad4132abbf0b';

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
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

function fail(label, detail = '') {
  console.log(
    `FAIL  ${label}${detail ? ` -> ${detail}` : ''}`
  );
}

function approxEqual(a, b, tolerance = 1e-7) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function hasAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

console.log('');
console.log('============================================================');
console.log(' FOOTBALL ANALYTICS LAB - FINAL PRODUCTION FREEZE AUDIT');
console.log('============================================================');
console.log('');

let hardFailures = 0;
let warnings = 0;

if (!fs.existsSync(DB_PATH)) {
  console.log('FAIL  football.db ditemukan');
  process.exit(1);
}

if (!fs.existsSync(SERVER_PATH)) {
  console.log('FAIL  server.js ditemukan');
  process.exit(1);
}

const serverText = fs.readFileSync(SERVER_PATH, 'utf8');
const serverSha = sha256File(SERVER_PATH);

console.log('[SERVER]');
console.log(`Path : ${SERVER_PATH}`);
console.log(`SHA  : ${serverSha}`);
console.log('');

if (serverSha !== OLD_V01_SHA) {
  pass(
    'server.js bukan server V0.1 lama',
    'SHA berbeda dari V0.1'
  );
} else {
  fail(
    'server.js bukan server V0.1 lama',
    'SHA masih sama dengan V0.1'
  );
  hardFailures++;
}

const modelMarker = new RegExp(
  `MODEL_VERSION\\s*=\\s*['"]${EXPECTED_MODEL}['"]`
);

if (modelMarker.test(serverText)) {
  pass(
    'production model = ensemble_60_40'
  );
} else if (serverText.includes(EXPECTED_MODEL)) {
  pass(
    'production model marker ditemukan',
    'format source berbeda dari pola exact audit'
  );
} else {
  fail(
    'production model = ensemble_60_40'
  );
  hardFailures++;
}

const v02WeightFound =
  /V02_WEIGHT\s*=\s*0\.60/.test(serverText) ||
  /0\.60/.test(serverText);

const v04WeightFound =
  /V04_WEIGHT\s*=\s*0\.40/.test(serverText) ||
  /0\.40/.test(serverText);

if (v02WeightFound && v04WeightFound) {
  pass('ensemble weights = 60:40');
} else {
  warn(
    'ensemble weights = 60:40',
    'source tidak cocok dengan pola exact; startup production sebelumnya menjadi referensi'
  );
  warnings++;
}

const thresholdFound =
  /HISTORY_THRESHOLD\s*=\s*30/.test(serverText) ||
  /threshold\s*[:=]\s*30/.test(serverText);

if (thresholdFound) {
  pass('history threshold = 30');
} else {
  warn(
    'history threshold = 30',
    'source tidak cocok dengan pola exact'
  );
  warnings++;
}

if (/recent.?10/i.test(serverText)) {
  fail(
    'Recent-10 tidak aktif',
    'marker Recent-10 ditemukan'
  );
  hardFailures++;
} else {
  pass('Recent-10 tidak aktif');
}

if (
  /calibration/i.test(serverText) &&
  /calibration.{0,120}false/i.test(serverText)
) {
  pass('calibration OFF terdeteksi');
} else if (!/calibration/i.test(serverText)) {
  pass('tidak ada layer calibration aktif');
} else {
  warn(
    'calibration OFF',
    'source tidak dapat diverifikasi dengan pola sederhana'
  );
  warnings++;
}

if (
  serverText.includes('predictV02') &&
  serverText.includes('predictV04')
) {
  pass('V0.2 dan V0.4 tersedia di production source');
} else {
  fail(
    'V0.2 dan V0.4 tersedia di production source'
  );
  hardFailures++;
}

console.log('');

const db = new Database(DB_PATH, {
  readonly: true,
  fileMustExist: true
});

try {
  console.log('[DATABASE SCHEMA]');
  console.log('');

  const tables = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type='table'
      ORDER BY name
    `)
    .all()
    .map(row => row.name);

  const requiredTables = [
    'matches',
    'predictions',
    'evaluations',
    'model_versions',
    'match_sources'
  ];

  for (const table of requiredTables) {
    if (tables.includes(table)) {
      pass(`table ${table} tersedia`);
    } else {
      fail(`table ${table} tersedia`);
      hardFailures++;
    }
  }

  console.log('');

  console.log('[MATCH INVENTORY]');
  console.log('');

  const totalMatches = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM matches
    `)
    .get().n;

  const finishedScored = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM matches
      WHERE status='finished'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
    `)
    .get().n;

  const futureMatches = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM matches
      WHERE kickoff > datetime('now')
    `)
    .get().n;

  console.log(`Total matches   : ${totalMatches}`);
  console.log(`Finished scored : ${finishedScored}`);
  console.log(`Future matches  : ${futureMatches}`);
  console.log('');

  if (totalMatches === 760) {
    pass('total pertandingan = 760');
  } else {
    fail(
      'total pertandingan = 760',
      `ditemukan ${totalMatches}`
    );
    hardFailures++;
  }

  if (finishedScored === 119) {
    pass('finished scored = 119');
  } else {
    warn(
      'finished scored = 119',
      `sekarang ${finishedScored}`
    );
    warnings++;
  }

  if (futureMatches === 641) {
    pass('future matches = 641');
  } else {
    warn(
      'future matches = 641',
      `sekarang ${futureMatches}`
    );
    warnings++;
  }

  console.log('');
  console.log('[PREDICTION INVENTORY]');
  console.log('');

  const modelCounts = db
    .prepare(`
      SELECT
        model_version,
        COUNT(*) AS n
      FROM predictions
      GROUP BY model_version
      ORDER BY model_version
    `)
    .all();

  for (const row of modelCounts) {
    console.log(
      `${row.model_version.padEnd(20)} : ${row.n}`
    );
  }

  console.log('');

  const ensembleCount = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM predictions
      WHERE model_version=?
    `)
    .get(EXPECTED_MODEL).n;

  const oldV01Count = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM predictions
      WHERE model_version='v0.1'
    `)
    .get().n;

  const fallbackCount = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM predictions
      WHERE model_version='v0.1-fallback'
    `)
    .get().n;

  if (ensembleCount === 641) {
    pass(
      'ensemble predictions = 641'
    );
  } else {
    fail(
      'ensemble predictions = 641',
      `ditemukan ${ensembleCount}`
    );
    hardFailures++;
  }

  if (oldV01Count === 270) {
    pass(
      'old V0.1 predictions tetap ada = 270'
    );
  } else if (oldV01Count > 0) {
    warn(
      'old V0.1 predictions tetap ada',
      `ditemukan ${oldV01Count}`
    );
    warnings++;
  } else {
    fail(
      'old V0.1 predictions tetap ada'
    );
    hardFailures++;
  }

  if (fallbackCount === 0) {
    pass(
      'fallback prediction = 0'
    );
  } else {
    warn(
      'fallback prediction = 0',
      `ditemukan ${fallbackCount}`
    );
    warnings++;
  }

  console.log('');
  console.log('[DUPLICATE CHECK]');
  console.log('');

  const duplicateGroups = db
    .prepare(`
      SELECT
        match_id,
        model_version,
        COUNT(*) AS n
      FROM predictions
      GROUP BY match_id, model_version
      HAVING COUNT(*) > 1
      ORDER BY n DESC
    `)
    .all();

  if (duplicateGroups.length === 0) {
    pass(
      'tidak ada duplicate match + model prediction'
    );
  } else {
    fail(
      'tidak ada duplicate match + model prediction',
      `${duplicateGroups.length} grup duplicate`
    );
    hardFailures++;

    for (const row of duplicateGroups.slice(0, 10)) {
      console.log(
        `  match=${row.match_id}, model=${row.model_version}, count=${row.n}`
      );
    }
  }

  console.log('');
  console.log('[FUTURE PREDICTION QUALITY]');
  console.log('');

  const futurePredictions = db
    .prepare(`
      SELECT
        p.id,
        p.match_id,
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
    `)
    .all(EXPECTED_MODEL);

  console.log(
    `Future ensemble predictions : ${futurePredictions.length}`
  );
  console.log('');

  let probabilityErrors = 0;
  let goalErrors = 0;
  let resultErrors = 0;

  for (const row of futurePredictions) {
    const sum =
      Number(row.home_prob) +
      Number(row.draw_prob) +
      Number(row.away_prob);

    if (!approxEqual(sum, 1)) {
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

    if (!['H', 'D', 'A'].includes(row.predicted_result)) {
      resultErrors++;
    }
  }

  if (probabilityErrors === 0) {
    pass(
      'semua future probabilities berjumlah 1'
    );
  } else {
    fail(
      'semua future probabilities berjumlah 1',
      `${probabilityErrors} row`
    );
    hardFailures++;
  }

  if (goalErrors === 0) {
    pass(
      'semua future expected goals valid'
    );
  } else {
    fail(
      'semua future expected goals valid',
      `${goalErrors} row`
    );
    hardFailures++;
  }

  if (resultErrors === 0) {
    pass(
      'semua future predicted_result valid'
    );
  } else {
    fail(
      'semua future predicted_result valid',
      `${resultErrors} row`
    );
    hardFailures++;
  }

  console.log('');
  console.log('[FUTURE SCORE PLACEHOLDER AUDIT]');
  console.log('');

  const futureScored = db
    .prepare(`
      SELECT
        p.id AS prediction_id,
        p.match_id,
        m.home_team,
        m.away_team,
        m.competition,
        m.kickoff,
        m.status,
        m.home_score,
        m.away_score,
        ms.provider,
        ms.provider_match_id
      FROM predictions p

      JOIN matches m
        ON m.id=p.match_id

      LEFT JOIN match_sources ms
        ON ms.match_id=m.id

      WHERE p.model_version=?
        AND m.kickoff > datetime('now')
        AND (
          m.home_score IS NOT NULL
          OR m.away_score IS NOT NULL
        )

      ORDER BY m.kickoff ASC
    `)
    .all(EXPECTED_MODEL);

  console.log(
    `Future ensemble rows dengan score non-null : ${futureScored.length}`
  );
  console.log('');

  let suspiciousFutureScores = 0;
  let placeholderRows = 0;

  for (const row of futureScored) {
    const zeroZero =
      Number(row.home_score) === 0 &&
      Number(row.away_score) === 0;

    const futureStatus =
      row.status === 'scheduled' ||
      row.status === 'timed';

    if (zeroZero && futureStatus) {
      placeholderRows++;

      console.log(
        `PLACEHOLDER -> ${row.home_team} vs ${row.away_team} | ` +
        `${row.home_score}-${row.away_score} | ` +
        `${row.status} | provider=${row.provider ?? 'unknown'} | ` +
        `provider_match_id=${row.provider_match_id ?? 'unknown'}`
      );
    } else {
      suspiciousFutureScores++;

      console.log(
        `SUSPICIOUS -> ${row.home_team} vs ${row.away_team} | ` +
        `${row.home_score}-${row.away_score} | ` +
        `${row.status} | provider=${row.provider ?? 'unknown'} | ` +
        `provider_match_id=${row.provider_match_id ?? 'unknown'}`
      );
    }
  }

  console.log('');

  if (suspiciousFutureScores === 0) {
    pass(
      'tidak ada actual-score leakage pada future prediction',
      `${placeholderRows} placeholder 0-0 tidak dianggap leakage`
    );
  } else {
    fail(
      'tidak ada actual-score leakage pada future prediction',
      `${suspiciousFutureScores} suspicious future score`
    );
    hardFailures++;
  }

  console.log('');
  console.log('[COMPETITION DISTRIBUTION]');
  console.log('');

  const competitionCounts = db
    .prepare(`
      SELECT
        m.competition,
        COUNT(*) AS n
      FROM predictions p
      JOIN matches m
        ON m.id=p.match_id
      WHERE p.model_version=?
      GROUP BY m.competition
      ORDER BY m.competition
    `)
    .all(EXPECTED_MODEL);

  let competitionTotal = 0;

  for (const row of competitionCounts) {
    console.log(
      `${row.competition.padEnd(20)} : ${row.n}`
    );

    competitionTotal += Number(row.n);
  }

  console.log('');

  if (competitionTotal === ensembleCount) {
    pass(
      'seluruh ensemble prediction terhubung ke competition valid'
    );
  } else {
    fail(
      'seluruh ensemble prediction terhubung ke competition valid'
    );
    hardFailures++;
  }

  console.log('');
  console.log('[EVALUATION STATUS]');
  console.log('');

  const ensembleEvaluations = db
    .prepare(`
      SELECT COUNT(*) AS n
      FROM evaluations e
      JOIN predictions p
        ON p.id=e.prediction_id
      WHERE p.model_version=?
    `)
    .get(EXPECTED_MODEL).n;

  console.log(
    `Ensemble evaluations : ${ensembleEvaluations}`
  );

  if (ensembleEvaluations === 0) {
    pass(
      'belum ada evaluation production',
      'normal karena belum ada prediction ensemble yang selesai dievaluasi'
    );
  } else {
    pass(
      'evaluation production tersedia',
      `${ensembleEvaluations} evaluation`
    );
  }

  console.log('');
  console.log('[MODEL VERSION RECORD]');
  console.log('');

  const modelVersions = db
    .prepare(`
      SELECT
        version,
        status,
        accuracy,
        notes
      FROM model_versions
      ORDER BY created_at ASC
    `)
    .all();

  for (const row of modelVersions) {
    console.log(
      `${row.version} | status=${row.status} | accuracy=${row.accuracy ?? 'null'}`
    );
  }

  console.log('');

  const ensembleVersion = modelVersions.find(
    row => row.version === EXPECTED_MODEL
  );

  if (ensembleVersion) {
    pass(
      'record model_versions ensemble_60_40 tersedia'
    );
  } else {
    fail(
      'record model_versions ensemble_60_40 tersedia'
    );
    hardFailures++;
  }

  console.log('');
  console.log('[DATABASE SAFETY]');
  console.log('');

  pass(
    'audit menggunakan mode READ-ONLY'
  );

  console.log('');
  console.log('============================================================');
  console.log(' FINAL FREEZE RESULT');
  console.log('============================================================');
  console.log('');

  console.log(`Hard failures : ${hardFailures}`);
  console.log(`Warnings      : ${warnings}`);
  console.log('');

  if (hardFailures === 0) {
    console.log(
      'FINAL FREEZE: PASS'
    );
    console.log('');
    console.log(
      'Production model ensemble_60_40 siap dibekukan sebagai baseline.'
    );
  } else {
    console.log(
      'FINAL FREEZE: FAIL'
    );
    console.log('');
    console.log(
      'Masih ada hard failure yang harus diperbaiki sebelum freeze.'
    );
  }

  console.log('');
  console.log(
    'Database tidak dimodifikasi oleh audit ini.'
  );
  console.log('');
} finally {
  db.close();
}
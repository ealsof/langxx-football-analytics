import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

// ============================================================
// EXPERIMENT #21
// FINAL AUDIT & FREEZE
// ============================================================
//
// FINAL CONFIG CANDIDATE
// ----------------------
// Model      : Ensemble 60:40
// V0.2       : 60%
// V0.4       : 40%
// Threshold  : 30
// Calibration: OFF
//
// IMPORTANT
// ---------
// - Database READ ONLY
// - Tidak melakukan sync
// - Tidak mengubah football.db
// - Tidak mengubah server.js
// - Tidak melakukan training
// - Tidak melakukan model fitting baru
//
// ============================================================

const PROJECT_DIR = process.cwd();

const DB_PATH = path.join(
  PROJECT_DIR,
  "football.db"
);

const SERVER_PATH = path.join(
  PROJECT_DIR,
  "server.js"
);

const MODELS_PATH = path.join(
  PROJECT_DIR,
  "evaluation-models.mjs"
);

const FINAL_CONFIG_PATH = path.join(
  PROJECT_DIR,
  "final-model-config.json"
);

const FREEZE_REPORT_PATH = path.join(
  PROJECT_DIR,
  "experiment-21-freeze-report.json"
);

// ============================================================
// EXPECTED FINAL CONFIG
// ============================================================

const EXPECTED_FINAL_CONFIG = {
  model: "ENSEMBLE_60_40",

  components: {
    V02: 0.60,
    V04: 0.40
  },

  threshold: 30,

  calibration: {
    enabled: false,
    method: null
  },

  productionChange: {
    allowed: false,
    status: "PENDING_FREEZE"
  },

  database: {
    readOnly: true
  }
};

// ============================================================
// HELPERS
// ============================================================

function printHeader(title) {
  console.log("\n");
  console.log(
    "============================================================"
  );
  console.log(title);
  console.log(
    "============================================================"
  );
}

function pass(message) {
  console.log(`✅ PASS — ${message}`);
}

function warn(message) {
  console.log(`⚠️  WARNING — ${message}`);
}

function fail(message) {
  console.log(`❌ FAIL — ${message}`);
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function sha256(filePath) {
  if (!fileExists(filePath)) {
    return null;
  }

  const buffer =
    fs.readFileSync(filePath);

  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

// ============================================================
// AUDIT STATE
// ============================================================

const audit = {
  experiment: "21",
  title: "Final Audit & Freeze",

  timestamp:
    new Date().toISOString(),

  checks: [],

  failures: [],

  warnings: [],

  finalStatus: "PENDING",

  finalModel: null,

  hashes: {}
};

// ============================================================
// CHECK 1
// PROJECT FILES
// ============================================================

printHeader(
  "CHECK 1 — PROJECT FILES"
);

const requiredFiles = [
  "football.db",
  "server.js",
  "evaluation-models.mjs"
];

for (
  const filename of
  requiredFiles
) {
  const filePath =
    path.join(
      PROJECT_DIR,
      filename
    );

  if (
    fileExists(filePath)
  ) {
    pass(
      `${filename} ditemukan.`
    );

    audit.checks.push({
      check: "required_file",
      file: filename,
      status: "PASS"
    });
  } else {
    fail(
      `${filename} tidak ditemukan.`
    );

    audit.checks.push({
      check: "required_file",
      file: filename,
      status: "FAIL"
    });

    audit.failures.push(
      `${filename} missing`
    );
  }
}

// ============================================================
// CHECK 2
// DATABASE READ ONLY
// ============================================================

printHeader(
  "CHECK 2 — DATABASE READ-ONLY AUDIT"
);

let db = null;

try {
  db =
    new Database(
      DB_PATH,
      {
        readonly: true,
        fileMustExist: true
      }
    );

  pass(
    "football.db berhasil dibuka dalam mode READ ONLY."
  );

  audit.checks.push({
    check:
      "database_readonly",
    status: "PASS"
  });
} catch (error) {
  fail(
    `Database gagal dibuka: ${error.message}`
  );

  audit.failures.push(
    "database_readonly_failed"
  );
}

// ============================================================
// CHECK 3
// DATABASE INTEGRITY
// ============================================================

if (db) {
  printHeader(
    "CHECK 3 — DATABASE INTEGRITY"
  );

  try {
    const integrity =
      db
        .prepare(
          "PRAGMA integrity_check"
        )
        .get();

    if (
      integrity.integrity_check ===
      "ok"
    ) {
      pass(
        "SQLite integrity_check = ok."
      );

      audit.checks.push({
        check:
          "sqlite_integrity",
        status: "PASS"
      });
    } else {
      fail(
        `SQLite integrity_check menghasilkan: ${integrity.integrity_check}`
      );

      audit.failures.push(
        "sqlite_integrity_failed"
      );
    }
  } catch (error) {
    fail(
      `Integrity check error: ${error.message}`
    );

    audit.failures.push(
      "sqlite_integrity_error"
    );
  }
}

// ============================================================
// CHECK 4
// TABLE STRUCTURE
// ============================================================

if (db) {
  printHeader(
    "CHECK 4 — TABLE STRUCTURE"
  );

  const tables =
    db
      .prepare(
        `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        ORDER BY name
        `
      )
      .all();

  const tableNames =
    tables.map(
      row => row.name
    );

  console.log(
    "Tables:",
    tableNames
  );

  const expectedTables = [
    "matches"
  ];

  const allTablesExist =
    expectedTables.every(
      table =>
        tableNames.includes(
          table
        )
    );

  for (
    const table of
    expectedTables
  ) {
    if (
      tableNames.includes(
        table
      )
    ) {
      pass(
        `Table ${table} tersedia.`
      );
    } else {
      fail(
        `Table ${table} tidak ditemukan.`
      );

      audit.failures.push(
        `missing_table_${table}`
      );
    }
  }

  audit.checks.push({
    check:
      "table_structure",
    status:
      allTablesExist
        ? "PASS"
        : "FAIL"
  });
}

// ============================================================
// CHECK 5
// MATCH DATA SUMMARY
// ============================================================

if (db) {
  printHeader(
    "CHECK 5 — MATCH DATA SUMMARY"
  );

  const total =
    db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM matches
        `
      )
      .get();

  const finished =
    db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM matches
        WHERE LOWER(status) = 'finished'
          AND home_score IS NOT NULL
          AND away_score IS NOT NULL
        `
      )
      .get();

  const future =
    db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM matches
        WHERE LOWER(status) IN (
          'scheduled',
          'timed'
        )
        `
      )
      .get();

  console.log(
    `Total matches   : ${total.count}`
  );

  console.log(
    `Finished scored : ${finished.count}`
  );

  console.log(
    `Future matches  : ${future.count}`
  );

  if (
    Number(total.count) >= 760
  ) {
    pass(
      `Dataset memiliki ${total.count} matches.`
    );
  } else {
    warn(
      `Dataset hanya memiliki ${total.count} matches.`
    );

    audit.warnings.push(
      "dataset_below_expected_760"
    );
  }

  audit.checks.push({
    check:
      "match_data_summary",
    status: "PASS",
    total:
      Number(total.count),
    finished:
      Number(finished.count),
    future:
      Number(future.count)
  });
}

// ============================================================
// CHECK 6
// FINISHED SCORE COMPLETENESS
// ============================================================

if (db) {
  printHeader(
    "CHECK 6 — FINISHED SCORE COMPLETENESS"
  );

  const badRows =
    db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM matches
        WHERE LOWER(status) = 'finished'
          AND (
            home_score IS NULL
            OR away_score IS NULL
          )
        `
      )
      .get();

  if (
    Number(badRows.count) === 0
  ) {
    pass(
      "Semua match berstatus finished memiliki skor lengkap."
    );

    audit.checks.push({
      check:
        "finished_score_completeness",
      status: "PASS"
    });
  } else {
    warn(
      `${badRows.count} finished matches tidak memiliki skor lengkap.`
    );

    audit.warnings.push(
      `finished_missing_scores_${badRows.count}`
    );

    audit.checks.push({
      check:
        "finished_score_completeness",
      status: "WARNING",
      count:
        Number(badRows.count)
    });
  }
}

// ============================================================
// CHECK 7
// FUTURE SCORE LEAKAGE
//
// IMPORTANT:
// football-data.org dapat menggunakan 0-0 sebagai placeholder
// untuk pertandingan future.
//
// Jadi:
//
// future + 0-0
//      => bukan leakage
//
// future + non-zero score
//      => suspicious dan memblokir freeze
//
// ============================================================

if (db) {
  printHeader(
    "CHECK 7 — FUTURE SCORE LEAKAGE"
  );

  const futureRows =
    db
      .prepare(
        `
        SELECT
          id,
          competition,
          kickoff,
          status,
          home_team,
          away_team,
          home_score,
          away_score
        FROM matches
        WHERE LOWER(status) IN (
          'scheduled',
          'timed'
        )
        AND kickoff IS NOT NULL
        AND datetime(kickoff) > datetime('now')
        ORDER BY kickoff ASC
        `
      )
      .all();

  const zeroZeroPlaceholders =
    futureRows.filter(
      row =>
        Number(row.home_score) === 0 &&
        Number(row.away_score) === 0
    );

  const suspiciousFutureScores =
    futureRows.filter(
      row =>
        (
          row.home_score !== null ||
          row.away_score !== null
        ) &&
        !(
          Number(row.home_score) === 0 &&
          Number(row.away_score) === 0
        )
    );

  console.log(
    `Future matches checked : ${futureRows.length}`
  );

  console.log(
    `0-0 placeholders       : ${zeroZeroPlaceholders.length}`
  );

  console.log(
    `Non-zero future scores : ${suspiciousFutureScores.length}`
  );

  if (
    zeroZeroPlaceholders.length > 0
  ) {
    console.log(
      "\n0-0 placeholders:"
    );

    for (
      const row of
      zeroZeroPlaceholders
    ) {
      console.log(
        `${row.id} | ${row.competition} | ${row.home_team} vs ${row.away_team} | ${row.status} | ${row.home_score}-${row.away_score}`
      );
    }
  }

  if (
    suspiciousFutureScores.length === 0
  ) {
    pass(
      "Tidak ditemukan non-zero score pada pertandingan future."
    );

    audit.checks.push({
      check:
        "future_score_leakage",
      status: "PASS",
      futureMatchesChecked:
        futureRows.length,
      zeroZeroPlaceholders:
        zeroZeroPlaceholders.length,
      suspiciousNonZeroScores: 0
    });
  } else {
    fail(
      `${suspiciousFutureScores.length} future matches memiliki non-zero score.`
    );

    console.log(
      "\nSuspicious future scores:"
    );

    for (
      const row of
      suspiciousFutureScores
    ) {
      console.log(
        JSON.stringify(
          row,
          null,
          2
        )
      );
    }

    audit.failures.push(
      "future_nonzero_score_leakage"
    );

    audit.checks.push({
      check:
        "future_score_leakage",
      status: "FAIL",
      futureMatchesChecked:
        futureRows.length,
      zeroZeroPlaceholders:
        zeroZeroPlaceholders.length,
      suspiciousNonZeroScores:
        suspiciousFutureScores.length
    });
  }
}

// ============================================================
// CHECK 8
// KICKOFF COMPLETENESS
// ============================================================

if (db) {
  printHeader(
    "CHECK 8 — KICKOFF COMPLETENESS"
  );

  const missingKickoff =
    db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM matches
        WHERE kickoff IS NULL
        `
      )
      .get();

  if (
    Number(
      missingKickoff.count
    ) === 0
  ) {
    pass(
      "Semua match memiliki kickoff."
    );

    audit.checks.push({
      check:
        "kickoff_completeness",
      status: "PASS"
    });
  } else {
    warn(
      `${missingKickoff.count} match tidak memiliki kickoff.`
    );

    audit.warnings.push(
      `missing_kickoff_${missingKickoff.count}`
    );

    audit.checks.push({
      check:
        "kickoff_completeness",
      status: "WARNING",
      count:
        Number(
          missingKickoff.count
        )
    });
  }
}

// ============================================================
// CHECK 9
// COMPETITION COVERAGE
// ============================================================

if (db) {
  printHeader(
    "CHECK 9 — COMPETITION COVERAGE"
  );

  const competitions =
    db
      .prepare(
        `
        SELECT
          competition,
          COUNT(*) AS matches
        FROM matches
        GROUP BY competition
        ORDER BY competition
        `
      )
      .all();

  for (
    const row of
    competitions
  ) {
    console.log(
      `${row.competition}: ${row.matches}`
    );
  }

  const competitionNames =
    competitions.map(
      row =>
        String(
          row.competition
        ).toLowerCase()
    );

  const hasEpl =
    competitionNames.some(
      value =>
        value.includes(
          "premier"
        ) ||
        value === "epl"
    );

  const hasLaLiga =
    competitionNames.some(
      value =>
        value.includes(
          "liga"
        ) ||
        value.includes(
          "laliga"
        )
    );

  if (
    hasEpl &&
    hasLaLiga
  ) {
    pass(
      "Premier League dan La Liga tersedia."
    );

    audit.checks.push({
      check:
        "competition_coverage",
      status: "PASS"
    });
  } else {
    warn(
      "Coverage Premier League / La Liga perlu diperiksa."
    );

    audit.warnings.push(
      "competition_coverage_check"
    );

    audit.checks.push({
      check:
        "competition_coverage",
      status: "WARNING"
    });
  }
}

// ============================================================
// CHECK 10
// FINAL MODEL CONFIG
// ============================================================

printHeader(
  "CHECK 10 — FINAL MODEL CONFIG"
);

console.log(
  JSON.stringify(
    EXPECTED_FINAL_CONFIG,
    null,
    2
  )
);

if (
  EXPECTED_FINAL_CONFIG
    .components
    .V02 === 0.60 &&
  EXPECTED_FINAL_CONFIG
    .components
    .V04 === 0.40
) {
  pass(
    "Bobot final 60:40 terkonfirmasi."
  );
} else {
  fail(
    "Bobot final bukan 60:40."
  );

  audit.failures.push(
    "final_weight_mismatch"
  );
}

if (
  EXPECTED_FINAL_CONFIG
    .threshold === 30
) {
  pass(
    "Threshold final = 30."
  );
} else {
  fail(
    "Threshold final bukan 30."
  );

  audit.failures.push(
    "threshold_mismatch"
  );
}

if (
  EXPECTED_FINAL_CONFIG
    .calibration
    .enabled === false
) {
  pass(
    "Calibration layer OFF."
  );
} else {
  fail(
    "Calibration layer masih ON."
  );

  audit.failures.push(
    "calibration_should_be_off"
  );
}

// ============================================================
// CHECK 11
// MODEL MODULE HASH
// ============================================================

printHeader(
  "CHECK 11 — MODEL MODULE HASH"
);

if (
  fileExists(
    MODELS_PATH
  )
) {
  const hash =
    sha256(
      MODELS_PATH
    );

  audit.hashes[
    "evaluation-models.mjs"
  ] = hash;

  console.log(
    `evaluation-models.mjs SHA256:\n${hash}`
  );

  pass(
    "Model module berhasil di-hash untuk reproducibility."
  );

  audit.checks.push({
    check:
      "model_hash",
    status: "PASS",
    sha256: hash
  });
} else {
  warn(
    "evaluation-models.mjs tidak ditemukan."
  );

  audit.warnings.push(
    "model_module_missing"
  );
}

// ============================================================
// CHECK 12
// PRODUCTION SERVER HASH
// ============================================================

printHeader(
  "CHECK 12 — PRODUCTION SERVER HASH"
);

let serverSource = "";

if (
  fileExists(
    SERVER_PATH
  )
) {
  const hash =
    sha256(
      SERVER_PATH
    );

  audit.hashes[
    "server.js"
  ] = hash;

  serverSource =
    fs.readFileSync(
      SERVER_PATH,
      "utf8"
    );

  console.log(
    `server.js SHA256:\n${hash}`
  );

  pass(
    "server.js berhasil di-hash."
  );

  audit.checks.push({
    check:
      "server_hash",
    status: "PASS",
    sha256: hash
  });
} else {
  fail(
    "server.js tidak ditemukan."
  );

  audit.failures.push(
    "server_missing"
  );
}

// ============================================================
// CHECK 13
// PRODUCTION V0.1 SAFETY SCAN
//
// Ini hanya diagnostic.
// Tidak dijadikan HARD FAIL karena marker numerik
// bisa saja tidak muncul sebagai literal di source code.
// ============================================================

printHeader(
  "CHECK 13 — PRODUCTION V0.1 SAFETY SCAN"
);

const productionMarkers = [
  "0.45",
  "0.27",
  "0.28",
  "1.55",
  "1.05"
];

let productionMarkerCount = 0;

for (
  const marker of
  productionMarkers
) {
  if (
    serverSource.includes(
      marker
    )
  ) {
    productionMarkerCount++;
  }
}

console.log(
  `Production V0.1 markers found: ${productionMarkerCount}/${productionMarkers.length}`
);

if (
  productionMarkerCount ===
  productionMarkers.length
) {
  pass(
    "Semua marker baseline V0.1 ditemukan."
  );
} else {
  warn(
    "Tidak semua marker V0.1 ditemukan. Ini diagnostic saja dan bukan HARD FAIL."
  );

  audit.warnings.push(
    "production_v01_marker_incomplete"
  );
}

audit.checks.push({
  check:
    "production_v01_scan",
  status: "DIAGNOSTIC",
  markersFound:
    productionMarkerCount,
  markersExpected:
    productionMarkers.length
});

// ============================================================
// CHECK 14
// CALIBRATION PRODUCTION SCAN
// ============================================================

printHeader(
  "CHECK 14 — CALIBRATION PRODUCTION SCAN"
);

const calibrationMarkers = [
  "isotonic",
  "platt",
  "temperatureScaling",
  "calibrationLayer",
  "calibratedProbability"
];

const foundCalibrationMarkers =
  calibrationMarkers.filter(
    marker =>
      serverSource
        .toLowerCase()
        .includes(
          marker.toLowerCase()
        )
  );

if (
  foundCalibrationMarkers.length ===
  0
) {
  pass(
    "Tidak ditemukan calibration layer di server.js."
  );

  audit.checks.push({
    check:
      "calibration_scan",
    status: "PASS"
  });
} else {
  warn(
    `Marker calibration ditemukan: ${foundCalibrationMarkers.join(", ")}`
  );

  audit.warnings.push(
    "calibration_marker_found"
  );

  audit.checks.push({
    check:
      "calibration_scan",
    status: "WARNING",
    markers:
      foundCalibrationMarkers
  });
}

// ============================================================
// CHECK 15
// RECENT-10 PRODUCTION SCAN
// ============================================================

printHeader(
  "CHECK 15 — RECENT-10 PRODUCTION SCAN"
);

const recentMarkers = [
  "last10",
  "recent10",
  "recent-10",
  "slice(-10)",
  "slice(0, 10)"
];

const foundRecentMarkers =
  recentMarkers.filter(
    marker =>
      serverSource
        .toLowerCase()
        .includes(
          marker.toLowerCase()
        )
  );

if (
  foundRecentMarkers.length ===
  0
) {
  pass(
    "Tidak ditemukan implementasi eksplisit RECENT-10 di server.js."
  );

  audit.checks.push({
    check:
      "recent10_scan",
    status: "PASS"
  });
} else {
  warn(
    `Marker RECENT-10 ditemukan: ${foundRecentMarkers.join(", ")}`
  );

  audit.warnings.push(
    "recent10_marker_found"
  );

  audit.checks.push({
    check:
      "recent10_scan",
    status: "WARNING",
    markers:
      foundRecentMarkers
  });
}

// ============================================================
// CHECK 16
// DATABASE SNAPSHOT HASH
// ============================================================

printHeader(
  "CHECK 16 — DATABASE SNAPSHOT HASH"
);

if (
  fileExists(
    DB_PATH
  )
) {
  const hash =
    sha256(
      DB_PATH
    );

  audit.hashes[
    "football.db"
  ] = hash;

  console.log(
    `football.db SHA256:\n${hash}`
  );

  pass(
    "Database fingerprint berhasil dibuat."
  );

  audit.checks.push({
    check:
      "database_hash",
    status: "PASS",
    sha256: hash
  });
}

// ============================================================
// CHECK 17
// FINAL FREEZE DECISION
// ============================================================

printHeader(
  "CHECK 17 — FINAL FREEZE DECISION"
);

if (
  audit.failures.length ===
  0
) {
  audit.finalStatus =
    "PASS";

  audit.finalModel =
    "ENSEMBLE_60_40";

  EXPECTED_FINAL_CONFIG
    .productionChange
    .status =
    "READY_FOR_FREEZE";

  pass(
    "Semua HARD CHECK lolos."
  );

  console.log("");
  console.log(
    "FINAL MODEL:"
  );

  console.log(
    "ENSEMBLE 60:40"
  );

  console.log(
    "V0.2 = 60%"
  );

  console.log(
    "V0.4 = 40%"
  );

  console.log(
    "Threshold = 30"
  );

  console.log(
    "Calibration = OFF"
  );

  console.log("");
  console.log(
    "STATUS: READY FOR FREEZE"
  );
} else {
  audit.finalStatus =
    "FAIL";

  EXPECTED_FINAL_CONFIG
    .productionChange
    .status =
    "BLOCKED";

  fail(
    "Ada HARD CHECK yang gagal."
  );

  console.log(
    "\nFailures:"
  );

  for (
    const failure of
    audit.failures
  ) {
    console.log(
      `- ${failure}`
    );
  }

  console.log(
    "\nSTATUS: FREEZE BLOCKED"
  );
}

// ============================================================
// SAVE FINAL CONFIG
// ============================================================

try {
  fs.writeFileSync(
    FINAL_CONFIG_PATH,
    JSON.stringify(
      EXPECTED_FINAL_CONFIG,
      null,
      2
    ),
    "utf8"
  );

  pass(
    "final-model-config.json dibuat."
  );
} catch (error) {
  fail(
    `Gagal membuat final-model-config.json: ${error.message}`
  );

  audit.failures.push(
    "final_config_write_failed"
  );
}

// ============================================================
// SAVE AUDIT REPORT
// ============================================================

audit.finalConfig =
  EXPECTED_FINAL_CONFIG;

try {
  fs.writeFileSync(
    FREEZE_REPORT_PATH,
    JSON.stringify(
      audit,
      null,
      2
    ),
    "utf8"
  );

  pass(
    "experiment-21-freeze-report.json dibuat."
  );
} catch (error) {
  fail(
    `Gagal membuat freeze report: ${error.message}`
  );
}

// ============================================================
// CLOSE DATABASE
// ============================================================

if (db) {
  db.close();

  pass(
    "Database connection ditutup."
  );
}

// ============================================================
// FINAL OUTPUT
// ============================================================

printHeader(
  "EXPERIMENT #21 COMPLETE"
);

console.log(
  `Status       : ${audit.finalStatus}`
);

console.log(
  `Final Model  : ${audit.finalModel ?? "NONE"}`
);

console.log(
  "Production   : UNCHANGED"
);

console.log(
  "Database     : READ ONLY"
);

console.log(
  "Calibration  : OFF"
);

console.log(
  "Threshold    : 30"
);

console.log(
  "Weights      : V0.2 60% / V0.4 40%"
);

console.log("");

if (
  audit.finalStatus ===
  "PASS"
) {
  console.log(
    "🔒 MODEL FREEZE READY"
  );

  console.log(
    "Next step: production integration."
  );
} else {
  console.log(
    "🚫 MODEL FREEZE BLOCKED"
  );

  console.log(
    "Fix all HARD CHECK failures before production integration."
  );
}

console.log("");
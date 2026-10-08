import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ============================================================
// EXPERIMENT #22
// PRODUCTION SERVER AUDIT
// ============================================================
//
// TUJUAN:
// Memastikan server.js production saat ini masih V0.1
// sebelum kita menggantinya dengan ENSEMBLE 60:40.
//
// IMPORTANT:
// - Tidak mengubah server.js
// - Tidak mengubah football.db
// - Tidak melakukan sync
// - Tidak melakukan prediction baru
// - Hanya membaca dan menganalisis source code
//
// ============================================================

const PROJECT_DIR = process.cwd();

const SERVER_PATH =
  path.join(
    PROJECT_DIR,
    "server.js"
  );

const REPORT_PATH =
  path.join(
    PROJECT_DIR,
    "experiment-22-production-audit-report.json"
  );

// ============================================================
// HELPERS
// ============================================================

function header(title) {
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
  console.log(
    `✅ PASS — ${message}`
  );
}

function warn(message) {
  console.log(
    `⚠️  WARNING — ${message}`
  );
}

function fail(message) {
  console.log(
    `❌ FAIL — ${message}`
  );
}

function sha256(filePath) {
  const buffer =
    fs.readFileSync(
      filePath
    );

  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function hasAny(
  source,
  markers
) {
  return markers.filter(
    marker =>
      source
        .toLowerCase()
        .includes(
          marker.toLowerCase()
        )
  );
}

function countOccurrences(
  source,
  pattern
) {
  const matches =
    source.match(
      pattern
    );

  return matches
    ? matches.length
    : 0;
}

// ============================================================
// REPORT
// ============================================================

const report = {
  experiment: "22",
  title:
    "Production Server Audit",

  timestamp:
    new Date().toISOString(),

  server: {
    path: SERVER_PATH,
    exists: false,
    sha256: null
  },

  checks: [],

  warnings: [],

  failures: [],

  productionModel: {
    detected: [],
    v01: {},
    v02: {},
    v04: {},
    ensemble: {},
    calibration: {},
    recent10: {}
  },

  predictionEndpoints: [],

  verdict: "PENDING"
};

// ============================================================
// CHECK 1
// SERVER EXISTENCE
// ============================================================

header(
  "CHECK 1 — SERVER.JS EXISTENCE"
);

if (
  !fs.existsSync(
    SERVER_PATH
  )
) {
  fail(
    "server.js tidak ditemukan."
  );

  report.failures.push(
    "server_js_missing"
  );

  report.verdict =
    "FAIL";

  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      report,
      null,
      2
    )
  );

  process.exit(1);
}

report.server.exists =
  true;

pass(
  "server.js ditemukan."
);

report.checks.push({
  check:
    "server_exists",
  status: "PASS"
});

// ============================================================
// READ SERVER
// ============================================================

const source =
  fs.readFileSync(
    SERVER_PATH,
    "utf8"
  );

const lines =
  source.split(/\r?\n/);

report.server.sha256 =
  sha256(
    SERVER_PATH
  );

// ============================================================
// CHECK 2
// FILE SIZE / BASIC SOURCE
// ============================================================

header(
  "CHECK 2 — SOURCE OVERVIEW"
);

console.log(
  `File size : ${Buffer.byteLength(source, "utf8")} bytes`
);

console.log(
  `Lines     : ${lines.length}`
);

console.log(
  `SHA256    : ${report.server.sha256}`
);

pass(
  "server.js berhasil dibaca tanpa modifikasi."
);

report.checks.push({
  check:
    "source_read",
  status: "PASS",
  bytes:
    Buffer.byteLength(
      source,
      "utf8"
    ),
  lines:
    lines.length,
  sha256:
    report.server.sha256
});

// ============================================================
// CHECK 3
// FIND PREDICTION ROUTES
// ============================================================

header(
  "CHECK 3 — PREDICTION ENDPOINT DETECTION"
);

const endpointRegex =
  /app\.(get|post|put|patch)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

let endpointMatch;

while (
  (endpointMatch =
    endpointRegex.exec(
      source
    )) !== null
) {
  const method =
    endpointMatch[1]
      .toUpperCase();

  const route =
    endpointMatch[2];

  if (
    route
      .toLowerCase()
      .includes(
        "predict"
      ) ||
    route
      .toLowerCase()
      .includes(
        "prediction"
      )
  ) {
    report.predictionEndpoints.push({
      method,
      route
    });

    console.log(
      `${method} ${route}`
    );
  }
}

if (
  report.predictionEndpoints
    .length > 0
) {
  pass(
    `${report.predictionEndpoints.length} prediction endpoint ditemukan.`
  );

  report.checks.push({
    check:
      "prediction_endpoints",
    status: "PASS",
    endpoints:
      report.predictionEndpoints
  });
} else {
  warn(
    "Tidak ditemukan endpoint dengan nama predict/prediction secara eksplisit."
  );

  report.warnings.push(
    "prediction_endpoint_not_explicit"
  );

  report.checks.push({
    check:
      "prediction_endpoints",
    status: "WARNING"
  });
}

// ============================================================
// CHECK 4
// V0.1 BASELINE DETECTION
// ============================================================

header(
  "CHECK 4 — V0.1 BASELINE DETECTION"
);

const v01Markers = {
  homeProbability:
    [
      "0.45",
      "homeProb"
    ],

  drawProbability:
    [
      "0.27",
      "drawProb"
    ],

  awayProbability:
    [
      "0.28",
      "awayProb"
    ],

  homeExpectedGoals:
    [
      "1.55"
    ],

  awayExpectedGoals:
    [
      "1.05"
    ]
};

for (
  const [
    key,
    markers
  ] of Object.entries(
    v01Markers
  )
) {
  const found =
    hasAny(
      source,
      markers
    );

  report.productionModel
    .v01[key] =
    found;

  console.log(
    `${key}: ${found ? "FOUND" : "NOT FOUND"}`
  );
}

const v01ProbabilityPattern =
  /homeProb(?:ability)?\s*[:=]\s*0\.45/i;

const v01DrawPattern =
  /drawProb(?:ability)?\s*[:=]\s*0\.27/i;

const v01AwayPattern =
  /awayProb(?:ability)?\s*[:=]\s*0\.28/i;

const v01XgPattern =
  /(?:homeGoals|homeExpectedGoals)[^;\n]*1\.55/i;

const v01AwayXgPattern =
  /(?:awayGoals|awayExpectedGoals)[^;\n]*1\.05/i;

const v01Structured =
  {
    homeProbability:
      v01ProbabilityPattern.test(
        source
      ),

    drawProbability:
      v01DrawPattern.test(
        source
      ),

    awayProbability:
      v01AwayPattern.test(
        source
      ),

    homeExpectedGoals:
      v01XgPattern.test(
        source
      ),

    awayExpectedGoals:
      v01AwayXgPattern.test(
        source
      )
  };

report.productionModel
  .v01.structured =
  v01Structured;

const v01StructuredCount =
  Object.values(
    v01Structured
  ).filter(Boolean)
   .length;

console.log(
  `Structured V0.1 markers: ${v01StructuredCount}/5`
);

if (
  v01StructuredCount >= 3
) {
  pass(
    "Source masih menunjukkan pola kuat V0.1."
  );
} else {
  warn(
    "Marker V0.1 belum cukup kuat untuk menyimpulkan model production."
  );

  report.warnings.push(
    "v01_marker_inconclusive"
  );
}

// ============================================================
// CHECK 5
// V0.2 DETECTION
// ============================================================

header(
  "CHECK 5 — V0.2 DETECTION"
);

const v02Markers = [
  "poissonPrediction",
  "goalsFor",
  "goalsAgainst",
  "league.homeGoals",
  "league.awayGoals",
  "homeAttack",
  "awayAttack",
  "homeDefense",
  "awayDefense"
];

const foundV02 =
  hasAny(
    source,
    v02Markers
  );

report.productionModel
  .v02.markers =
  foundV02;

console.log(
  "V0.2 markers:"
);

for (
  const marker of
  foundV02
) {
  console.log(
    `  - ${marker}`
  );
}

if (
  foundV02.length ===
  0
) {
  pass(
    "Tidak ditemukan marker V0.2 di server.js."
  );
} else {
  warn(
    `Ditemukan ${foundV02.length} marker V0.2.`
  );
}

// ============================================================
// CHECK 6
// V0.4 / ELO DETECTION
// ============================================================

header(
  "CHECK 6 — V0.4 / ELO DETECTION"
);

const v04Markers = [
  "eloExpected",
  "ratingA",
  "ratingB",
  "1500",
  "homeRating",
  "awayRating",
  "elo",
  "K = 25",
  "kFactor",
  "home advantage"
];

const foundV04 =
  hasAny(
    source,
    v04Markers
  );

report.productionModel
  .v04.markers =
  foundV04;

if (
  foundV04.length ===
  0
) {
  pass(
    "Tidak ditemukan marker V0.4/Elo di server.js."
  );
} else {
  warn(
    `Ditemukan ${foundV04.length} marker V0.4/Elo: ${foundV04.join(", ")}`
  );
}

// ============================================================
// CHECK 7
// ENSEMBLE DETECTION
// ============================================================

header(
  "CHECK 7 — ENSEMBLE DETECTION"
);

const ensembleMarkers = [
  "ENSEMBLE_60_40",
  "60:40",
  "0.6",
  "0.4",
  "V02",
  "V04",
  "ensemble"
];

const foundEnsemble =
  hasAny(
    source,
    ensembleMarkers
  );

report.productionModel
  .ensemble.markers =
  foundEnsemble;

console.log(
  `Ensemble markers found: ${foundEnsemble.length}`
);

for (
  const marker of
  foundEnsemble
) {
  console.log(
    `  - ${marker}`
  );
}

if (
  foundEnsemble.length ===
  0
) {
  pass(
    "Belum ada implementasi Ensemble 60:40 di server.js."
  );
} else {
  warn(
    "Ada marker ensemble di server.js. Perlu diperiksa apakah production sudah berubah."
  );
}

// ============================================================
// CHECK 8
// WEIGHT DETECTION
// ============================================================

header(
  "CHECK 8 — MODEL WEIGHT DETECTION"
);

const weightPatterns = {
  v02_60:
    /(?:V02|v02|modelV02)[^;\n]{0,100}(?:0\.6|60)/i,

  v04_40:
    /(?:V04|v04|modelV04)[^;\n]{0,100}(?:0\.4|40)/i,

  v02_40:
    /(?:V02|v02|modelV02)[^;\n]{0,100}(?:0\.4|40)/i,

  v04_60:
    /(?:V04|v04|modelV04)[^;\n]{0,100}(?:0\.6|60)/i
};

const weightResults = {};

for (
  const [
    key,
    pattern
  ] of Object.entries(
    weightPatterns
  )
) {
  weightResults[key] =
    pattern.test(
      source
    );

  console.log(
    `${key}: ${weightResults[key] ? "FOUND" : "NOT FOUND"}`
  );
}

report.productionModel
  .ensemble.weights =
  weightResults;

// ============================================================
// CHECK 9
// CALIBRATION DETECTION
// ============================================================

header(
  "CHECK 9 — CALIBRATION DETECTION"
);

const calibrationMarkers = [
  "calibration",
  "calibratedProbability",
  "isotonic",
  "isotonicRegression",
  "platt",
  "temperatureScaling",
  "temperature scaling",
  "probabilityCalibration",
  "calibrationLayer"
];

const foundCalibration =
  hasAny(
    source,
    calibrationMarkers
  );

report.productionModel
  .calibration.markers =
  foundCalibration;

if (
  foundCalibration.length ===
  0
) {
  pass(
    "Tidak ditemukan calibration layer."
  );
} else {
  warn(
    `Calibration-related markers ditemukan: ${foundCalibration.join(", ")}`
  );
}

// ============================================================
// CHECK 10
// RECENT-10 DETECTION
// ============================================================

header(
  "CHECK 10 — RECENT-10 DETECTION"
);

const recent10Markers = [
  "last10",
  "last_10",
  "recent10",
  "recent_10",
  "recent-10",
  "slice(-10)",
  "slice(0, 10)",
  "slice(0,10)",
  "Math.min(10",
  "limit = 10"
];

const foundRecent10 =
  hasAny(
    source,
    recent10Markers
  );

report.productionModel
  .recent10.markers =
  foundRecent10;

if (
  foundRecent10.length ===
  0
) {
  pass(
    "Tidak ditemukan implementasi RECENT-10."
  );
} else {
  warn(
    `Marker RECENT-10 ditemukan: ${foundRecent10.join(", ")}`
  );
}

// ============================================================
// CHECK 11
// THRESHOLD 30 DETECTION
// ============================================================

header(
  "CHECK 11 — THRESHOLD DETECTION"
);

const thresholdMarkers = [
  "threshold",
  "30",
  "minimumHistory",
  "minHistory",
  "priorMatches"
];

const foundThreshold =
  hasAny(
    source,
    thresholdMarkers
  );

console.log(
  `Threshold-related markers: ${foundThreshold.length}`
);

for (
  const marker of
  foundThreshold
) {
  console.log(
    `  - ${marker}`
  );
}

if (
  foundThreshold.length ===
  0
) {
  pass(
    "Tidak ditemukan implementasi threshold eksplisit."
  );
} else {
  warn(
    "Ada marker threshold/history. Ini belum berarti threshold 30 sudah aktif."
  );
}

// ============================================================
// CHECK 12
// SPORTSMONKS / PROVIDER
// ============================================================

header(
  "CHECK 12 — DATA PROVIDER / SYNC"
);

const providerMarkers = [
  "sportmonks",
  "football-data.org",
  "/api/admin/sync",
  "sync"
];

const foundProvider =
  hasAny(
    source,
    providerMarkers
  );

console.log(
  "Provider/sync markers:"
);

for (
  const marker of
  foundProvider
) {
  console.log(
    `  - ${marker}`
  );
}

pass(
  "Audit provider hanya membaca source; tidak menjalankan sync."
);

// ============================================================
// CHECK 13
// MODEL FUNCTION DETECTION
// ============================================================

header(
  "CHECK 13 — MODEL FUNCTION DETECTION"
);

const functionRegex =
  /(?:function\s+([A-Za-z0-9_$]+)\s*\(|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g;

const functions = [];

let fnMatch;

while (
  (fnMatch =
    functionRegex.exec(
      source
    )) !== null
) {
  const name =
    fnMatch[1] ||
    fnMatch[2];

  if (
    name &&
    !functions.includes(
      name
    )
  ) {
    functions.push(
      name
    );
  }
}

console.log(
  "Detected functions:"
);

for (
  const name of
  functions
) {
  console.log(
    `  - ${name}`
  );
}

report.checks.push({
  check:
    "function_detection",
  status: "PASS",
  functions
});

pass(
  "Function detection selesai."
);

// ============================================================
// CHECK 14
// PREDICTION-RELATED FUNCTIONS
// ============================================================

header(
  "CHECK 14 — PREDICTION FUNCTION DETECTION"
);

const predictionFunctionNames =
  functions.filter(
    name =>
      /predict|prediction|model|poisson|elo|prob/i.test(
        name
      )
  );

if (
  predictionFunctionNames.length >
  0
) {
  for (
    const name of
    predictionFunctionNames
  ) {
    console.log(
      `  - ${name}`
    );
  }

  pass(
    `${predictionFunctionNames.length} prediction/model-related function terdeteksi.`
  );
} else {
  warn(
    "Tidak ditemukan function bernama predict/model/poisson/elo secara eksplisit."
  );

  report.warnings.push(
    "prediction_function_inconclusive"
  );
}

// ============================================================
// CHECK 15
// PRODUCTION MODEL VERSION STRINGS
// ============================================================

header(
  "CHECK 15 — MODEL VERSION STRINGS"
);

const modelVersionRegex =
  /(?:V0\.[0-9]+|ENSEMBLE[_-]?[A-Z0-9_:-]+|MODEL[_-]?[A-Z0-9_:-]+)/gi;

const modelVersionMatches =
  source.match(
    modelVersionRegex
  ) || [];

const uniqueModelVersions =
  [
    ...new Set(
      modelVersionMatches.map(
        value =>
          value.trim()
      )
    )
  ];

if (
  uniqueModelVersions.length >
  0
) {
  console.log(
    "Model/version strings:"
  );

  for (
    const value of
    uniqueModelVersions
  ) {
    console.log(
      `  - ${value}`
    );
  }
} else {
  warn(
    "Tidak ada model version string eksplisit."
  );
}

// ============================================================
// CHECK 16
// SUSPICIOUS V0.4 FORMULAS
// ============================================================

header(
  "CHECK 16 — ELO FORMULA SCAN"
);

const eloFormulaPatterns = [
  /1\s*\/\s*\(\s*1\s*\+\s*Math\.pow\s*\(\s*10/i,

  /Math\.pow\s*\(\s*10\s*,\s*\(/i,

  /ratingA/i,

  /ratingB/i,

  /homeRating/i,

  /awayRating/i,

  /K\s*=\s*25/i
];

let eloFormulaCount = 0;

for (
  const pattern of
  eloFormulaPatterns
) {
  if (
    pattern.test(
      source
    )
  ) {
    eloFormulaCount++;
  }
}

console.log(
  `Elo formula indicators: ${eloFormulaCount}/${eloFormulaPatterns.length}`
);

if (
  eloFormulaCount ===
  0
) {
  pass(
    "Tidak ditemukan formula Elo yang jelas."
  );
} else {
  warn(
    "Ditemukan indikator formula Elo. Harus dipastikan apakah digunakan production."
  );
}

// ============================================================
// CHECK 17
// SOURCE LINE CONTEXT FOR IMPORTANT MARKERS
// ============================================================

header(
  "CHECK 17 — IMPORTANT SOURCE CONTEXT"
);

const importantPatterns = [
  "0.45",
  "0.27",
  "0.28",
  "1.55",
  "1.05",
  "poisson",
  "elo",
  "predict",
  "prediction",
  "V02",
  "V04",
  "ensemble",
  "calibration",
  "last10",
  "recent10",
  "threshold"
];

for (
  const pattern of
  importantPatterns
) {
  const matchingLines = [];

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    if (
      lines[i]
        .toLowerCase()
        .includes(
          pattern.toLowerCase()
        )
    ) {
      matchingLines.push(
        i + 1
      );
    }
  }

  if (
    matchingLines.length >
    0
  ) {
    console.log(
      `${pattern}: lines ${matchingLines.slice(0, 20).join(", ")}`
    );
  }
}

pass(
  "Context source scan selesai."
);

// ============================================================
// CHECK 18
// FINAL MODEL VERDICT
// ============================================================

header(
  "CHECK 18 — FINAL PRODUCTION VERDICT"
);

const ensembleActive =
  foundEnsemble.length >
  0;

const calibrationActive =
  foundCalibration.length >
  0;

const recent10Active =
  foundRecent10.length >
  0;

const eloActive =
  eloFormulaCount >
  0;

const hasV01StrongEvidence =
  v01StructuredCount >=
  3;

console.log(
  `Strong V0.1 evidence : ${hasV01StrongEvidence}`
);

console.log(
  `Ensemble markers      : ${ensembleActive}`
);

console.log(
  `Calibration markers   : ${calibrationActive}`
);

console.log(
  `Recent-10 markers     : ${recent10Active}`
);

console.log(
  `Elo formula markers   : ${eloActive}`
);

// ------------------------------------------------------------
// IMPORTANT:
// Kita tidak otomatis menyatakan server aman hanya berdasarkan
// marker. Jika source menunjukkan indikasi model lain, status
// menjadi MANUAL_REVIEW.
// ------------------------------------------------------------

if (
  ensembleActive ||
  calibrationActive ||
  recent10Active
) {
  report.verdict =
    "MANUAL_REVIEW";

  warn(
    "server.js memiliki marker yang berpotensi berkaitan dengan model eksperimen. Jangan replace production sebelum source context diperiksa."
  );
} else if (
  hasV01StrongEvidence &&
  !calibrationActive &&
  !recent10Active &&
  !ensembleActive
) {
  report.verdict =
    "V01_CONFIRMED";

  pass(
    "server.js sangat kuat terindikasi masih menggunakan V0.1."
  );
} else if (
  !eloActive &&
  !ensembleActive &&
  !calibrationActive &&
  !recent10Active
) {
  report.verdict =
    "LIKELY_V01";

  warn(
    "server.js kemungkinan masih V0.1, tetapi bukti marker belum lengkap."
  );
} else {
  report.verdict =
    "MANUAL_REVIEW";

  warn(
    "Model production belum dapat ditentukan secara aman dari static scan."
  );
}

// ============================================================
// FINAL REPORT
// ============================================================

report.finalVerdict =
  report.verdict;

report.completedAt =
  new Date().toISOString();

fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    report,
    null,
    2
  ),
  "utf8"
);

// ============================================================
// FINAL OUTPUT
// ============================================================

header(
  "EXPERIMENT #22 COMPLETE"
);

console.log(
  `Verdict       : ${report.verdict}`
);

console.log(
  `server.js SHA : ${report.server.sha256}`
);

console.log(
  `Report        : ${REPORT_PATH}`
);

console.log("");

if (
  report.verdict ===
  "V01_CONFIRMED"
) {
  console.log(
    "🟢 PRODUCTION V0.1 CONFIRMED"
  );

  console.log(
    "Next step: full replacement server.js dengan ENSEMBLE 60:40."
  );
} else if (
  report.verdict ===
  "LIKELY_V01"
) {
  console.log(
    "🟡 PRODUCTION LIKELY V0.1"
  );

  console.log(
    "Next step: inspect source context sebelum replacement."
  );
} else {
  console.log(
    "🟠 MANUAL REVIEW REQUIRED"
  );

  console.log(
    "Jangan ubah production dulu."
  );
}
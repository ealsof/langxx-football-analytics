// ============================================================
// EXPERIMENT #20
// FINAL MODEL COMPARISON
// ============================================================
//
// Tujuan:
// Membandingkan V0.2, V0.4, dan 60:40 berdasarkan seluruh
// evidence eksperimen #9 - #19.
//
// IMPORTANT:
// - Tidak membaca / mengubah database.
// - Tidak mengubah production model.
// - Tidak melakukan model fitting baru.
// - Ini adalah FINAL EVIDENCE SCORECARD.
//
// ============================================================

const models = [
    "V0.2",
    "V0.4",
    "60:40"
  ];
  
  // ============================================================
  // EXPERIMENT #9
  // Weighted ensemble, threshold 30
  // ============================================================
  
  const exp9 = {
    "V0.2": {
      accuracy: 50.85,
      exact: 11.86,
      mae: 1.2322,
      brier: 0.2418
    },
  
    "V0.4": {
      accuracy: 35.59,
      exact: 6.78,
      mae: 1.1470,
      brier: 0.2300
    },
  
    "60:40": {
      accuracy: 50.85,
      exact: 8.47,
      mae: 1.1252,
      brier: 0.2135
    }
  };
  
  // ============================================================
  // EXPERIMENT #11
  // Competition stability
  // Threshold 30
  // ============================================================
  
  const exp11 = {
    "Premier League": {
      "V0.2": {
        accuracy: 50.00,
        exact: 10.00,
        mae: 1.3274,
        brier: 0.2583
      },
  
      "V0.4": {
        accuracy: 30.00,
        exact: 5.00,
        mae: 1.1718,
        brier: 0.2377
      },
  
      "60:40": {
        accuracy: 50.00,
        exact: 0.00,
        mae: 1.2333,
        brier: 0.2320
      }
    },
  
    "La Liga": {
      "V0.2": {
        accuracy: 51.28,
        exact: 12.82,
        mae: 1.1834,
        brier: 0.2333
      },
  
      "V0.4": {
        accuracy: 38.46,
        exact: 7.69,
        mae: 1.1342,
        brier: 0.2260
      },
  
      "60:40": {
        accuracy: 51.28,
        exact: 12.82,
        mae: 1.0698,
        brier: 0.2072
      }
    }
  };
  
  // ============================================================
  // EXPERIMENT #15
  // Temporal holdout
  // Combined validation N = 24
  // ============================================================
  
  const exp15 = {
    "V0.2": {
      accuracy: 45.83,
      exact: 8.33,
      mae: 1.2502,
      brier: 0.2220
    },
  
    "V0.4": {
      accuracy: 45.83,
      exact: 8.33,
      mae: 1.1908,
      brier: 0.2123
    },
  
    "60:40": {
      accuracy: 50.00,
      exact: 8.33,
      mae: 1.1548,
      brier: 0.2049
    }
  };
  
  // ============================================================
  // EXPERIMENT #16
  // Probability calibration
  // Combined validation N = 24
  // ============================================================
  
  const exp16 = {
    "V0.2": {
      accuracy: 45.83,
      brier: 0.2220,
      ece: 0.2284,
      mce: 0.6196
    },
  
    "V0.4": {
      accuracy: 45.83,
      brier: 0.2123,
      ece: 0.0985,
      mce: 0.1065
    },
  
    "60:40": {
      accuracy: 50.00,
      brier: 0.2049,
      ece: 0.0720,
      mce: 0.2251
    }
  };
  
  // ============================================================
  // EXPERIMENT #17
  // Rolling temporal validation
  // Combined N = 59
  // ============================================================
  
  const exp17 = {
    "V0.2": {
      accuracy: 50.85,
      exact: 11.86,
      mae: 1.2322,
      brier: 0.2418
    },
  
    "V0.4": {
      accuracy: 35.59,
      exact: 6.78,
      mae: 1.1470,
      brier: 0.2300
    },
  
    "60:40": {
      accuracy: 50.85,
      exact: 8.47,
      mae: 1.1252,
      brier: 0.2156
    }
  };
  
  // ============================================================
  // EXPERIMENT #18
  // Out-of-sample calibration
  //
  // IMPORTANT:
  // Production decision uses RAW probabilities.
  // Calibration layer was NOT promoted.
  //
  // Combined validation N = 24
  // ============================================================
  
  const exp18 = {
    "V0.2": {
      rawBrier: 0.2228,
      calibratedBrier: 0.2153,
      rawECE: 0.2524,
      calibratedECE: 0.1852
    },
  
    "V0.4": {
      rawBrier: 0.2120,
      calibratedBrier: 0.2205,
      rawECE: 0.0503,
      calibratedECE: 0.1119
    },
  
    "60:40": {
      rawBrier: 0.2048,
      calibratedBrier: 0.2100,
      rawECE: 0.1949,
      calibratedECE: 0.1380
    }
  };
  
  // ============================================================
  // EXPERIMENT #19
  // Stress test
  // Combined N = 59
  // ============================================================
  
  const exp19 = {
    "NORMAL": {
      "V0.2": {
        accuracy: 50.85,
        mae: 1.2317,
        brier: 0.2421
      },
  
      "V0.4": {
        accuracy: 35.59,
        mae: 1.1479,
        brier: 0.2297
      },
  
      "60:40": {
        accuracy: 50.85,
        mae: 1.1263,
        brier: 0.2155
      }
    },
  
    "RECENT-10": {
      "V0.2": {
        accuracy: 37.29,
        mae: 1.4659,
        brier: 0.2954
      },
  
      "V0.4": {
        accuracy: 35.59,
        mae: 1.2390,
        brier: 0.2298
      },
  
      "60:40": {
        accuracy: 37.29,
        mae: 1.2309,
        brier: 0.2413
      }
    },
  
    "REMOVE-20%": {
      "V0.2": {
        accuracy: 47.46,
        mae: 1.2349,
        brier: 0.2440
      },
  
      "V0.4": {
        accuracy: 35.59,
        mae: 1.1369,
        brier: 0.2321
      },
  
      "60:40": {
        accuracy: 47.46,
        mae: 1.1283,
        brier: 0.2167
      }
    },
  
    "LEAGUE-DOWN-10%": {
      "V0.2": {
        accuracy: 49.15,
        mae: 1.2891,
        brier: 0.2454
      },
  
      "V0.4": {
        accuracy: 35.59,
        mae: 1.1196,
        brier: 0.2283
      },
  
      "60:40": {
        accuracy: 50.85,
        mae: 1.1417,
        brier: 0.2162
      }
    },
  
    "LEAGUE-UP-10%": {
      "V0.2": {
        accuracy: 50.85,
        mae: 1.2012,
        brier: 0.2392
      },
  
      "V0.4": {
        accuracy: 35.59,
        mae: 1.1767,
        brier: 0.2312
      },
  
      "60:40": {
        accuracy: 50.85,
        mae: 1.1177,
        brier: 0.2149
      }
    }
  };
  
  // ============================================================
  // GENERIC SCORE HELPERS
  // ============================================================
  
  function rankDescending(values) {
    const sorted =
      [...models].sort(
        (a, b) =>
          values[b] -
          values[a]
      );
  
    const rank = {};
  
    sorted.forEach(
      (model, index) => {
        rank[model] =
          index + 1;
      }
    );
  
    return rank;
  }
  
  function rankAscending(values) {
    const sorted =
      [...models].sort(
        (a, b) =>
          values[a] -
          values[b]
      );
  
    const rank = {};
  
    sorted.forEach(
      (model, index) => {
        rank[model] =
          index + 1;
      }
    );
  
    return rank;
  }
  
  function average(
    values
  ) {
    return (
      values.reduce(
        (sum, value) =>
          sum + value,
        0
      ) /
      values.length
    );
  }
  
  // ============================================================
  // SCORECARD
  // ============================================================
  
  const scorecard = {};
  
  for (const model of models) {
    scorecard[model] = {
      wins: 0,
      podiums: 0,
      evidence: 0
    };
  }
  
  // ------------------------------------------------------------
  // #9 — Accuracy
  // ------------------------------------------------------------
  
  {
    const values = {};
  
    for (const model of models) {
      values[model] =
        exp9[model].accuracy;
    }
  
    const ranks =
      rankDescending(values);
  
    for (const model of models) {
      if (ranks[model] === 1) {
        scorecard[model].wins++;
      }
  
      if (ranks[model] <= 2) {
        scorecard[model].podiums++;
      }
    }
  
    console.log(
      "\n#9 Accuracy ranking:",
      ranks
    );
  }
  
  // ------------------------------------------------------------
  // #9 — MAE
  // ------------------------------------------------------------
  
  {
    const values = {};
  
    for (const model of models) {
      values[model] =
        exp9[model].mae;
    }
  
    const ranks =
      rankAscending(values);
  
    for (const model of models) {
      if (ranks[model] === 1) {
        scorecard[model].wins++;
      }
  
      if (ranks[model] <= 2) {
        scorecard[model].podiums++;
      }
    }
  
    console.log(
      "#9 MAE ranking:",
      ranks
    );
  }
  
  // ------------------------------------------------------------
  // #9 — Brier
  // ------------------------------------------------------------
  
  {
    const values = {};
  
    for (const model of models) {
      values[model] =
        exp9[model].brier;
    }
  
    const ranks =
      rankAscending(values);
  
    for (const model of models) {
      if (ranks[model] === 1) {
        scorecard[model].wins++;
      }
  
      if (ranks[model] <= 2) {
        scorecard[model].podiums++;
      }
    }
  
    console.log(
      "#9 Brier ranking:",
      ranks
    );
  }
  
  // ============================================================
  // #11 — Competition stability
  // ============================================================
  
  for (
    const competition of
    Object.keys(exp11)
  ) {
    for (
      const metric of
      [
        "accuracy",
        "mae",
        "brier"
      ]
    ) {
      const values = {};
  
      for (
        const model of
        models
      ) {
        values[model] =
          exp11[
            competition
          ][model][metric];
      }
  
      const ranks =
        (
          metric ===
          "accuracy"
        )
          ? rankDescending(
              values
            )
          : rankAscending(
              values
            );
  
      for (
        const model of
        models
      ) {
        if (
          ranks[model] === 1
        ) {
          scorecard[model]
            .wins++;
        }
  
        if (
          ranks[model] <= 2
        ) {
          scorecard[model]
            .podiums++;
        }
      }
  
      console.log(
        `#11 ${competition} ${metric}:`,
        ranks
      );
    }
  }
  
  // ============================================================
  // #15 — Temporal holdout
  // ============================================================
  
  for (
    const metric of
    [
      "accuracy",
      "mae",
      "brier"
    ]
  ) {
    const values = {};
  
    for (
      const model of
      models
    ) {
      values[model] =
        exp15[model][metric];
    }
  
    const ranks =
      (
        metric ===
        "accuracy"
      )
        ? rankDescending(
            values
          )
        : rankAscending(
            values
          );
  
    for (
      const model of
      models
    ) {
      if (
        ranks[model] === 1
      ) {
        scorecard[model]
          .wins++;
      }
  
      if (
        ranks[model] <= 2
      ) {
        scorecard[model]
          .podiums++;
      }
    }
  
    console.log(
      `#15 ${metric}:`,
      ranks
    );
  }
  
  // ============================================================
  // #16 — Calibration
  // ============================================================
  
  for (
    const metric of
    [
      "accuracy",
      "brier",
      "ece",
      "mce"
    ]
  ) {
    const values = {};
  
    for (
      const model of
      models
    ) {
      values[model] =
        exp16[model][metric];
    }
  
    const ranks =
      (
        metric ===
        "accuracy"
      )
        ? rankDescending(
            values
          )
        : rankAscending(
            values
          );
  
    for (
      const model of
      models
    ) {
      if (
        ranks[model] === 1
      ) {
        scorecard[model]
          .wins++;
      }
  
      if (
        ranks[model] <= 2
      ) {
        scorecard[model]
          .podiums++;
      }
    }
  
    console.log(
      `#16 ${metric}:`,
      ranks
    );
  }
  
  // ============================================================
  // #17 — Rolling temporal validation
  // ============================================================
  
  for (
    const metric of
    [
      "accuracy",
      "mae",
      "brier"
    ]
  ) {
    const values = {};
  
    for (
      const model of
      models
    ) {
      values[model] =
        exp17[model][metric];
    }
  
    const ranks =
      (
        metric ===
        "accuracy"
      )
        ? rankDescending(
            values
          )
        : rankAscending(
            values
          );
  
    for (
      const model of
      models
    ) {
      if (
        ranks[model] === 1
      ) {
        scorecard[model]
          .wins++;
      }
  
      if (
        ranks[model] <= 2
      ) {
        scorecard[model]
          .podiums++;
      }
    }
  
    console.log(
      `#17 ${metric}:`,
      ranks
    );
  }
  
  // ============================================================
  // #18 — OOS CALIBRATION
  //
  // IMPORTANT:
  // Raw probabilities are what matter for production.
  // Calibrated Brier is reported only as diagnostic evidence.
  // ============================================================
  
  for (
    const metric of
    [
      "rawBrier",
      "rawECE"
    ]
  ) {
    const values = {};
  
    for (
      const model of
      models
    ) {
      values[model] =
        exp18[model][metric];
    }
  
    const ranks =
      rankAscending(
        values
      );
  
    for (
      const model of
      models
    ) {
      if (
        ranks[model] === 1
      ) {
        scorecard[model]
          .wins++;
      }
  
      if (
        ranks[model] <= 2
      ) {
        scorecard[model]
          .podiums++;
      }
    }
  
    console.log(
      `#18 ${metric}:`,
      ranks
    );
  }
  
  // ============================================================
  // #19 — STRESS TEST
  // ============================================================
  
  for (
    const scenario of
    Object.keys(exp19)
  ) {
    for (
      const metric of
      [
        "accuracy",
        "mae",
        "brier"
      ]
    ) {
      const values = {};
  
      for (
        const model of
        models
      ) {
        values[model] =
          exp19[
            scenario
          ][model][metric];
      }
  
      const ranks =
        (
          metric ===
          "accuracy"
        )
          ? rankDescending(
              values
            )
          : rankAscending(
              values
            );
  
      for (
        const model of
        models
      ) {
        if (
          ranks[model] === 1
        ) {
          scorecard[model]
            .wins++;
        }
  
        if (
          ranks[model] <= 2
        ) {
          scorecard[model]
            .podiums++;
        }
      }
  
      console.log(
        `#19 ${scenario} ${metric}:`,
        ranks
      );
    }
  }
  
  // ============================================================
  // FINAL SCORECARD
  // ============================================================
  
  console.log("\n");
  console.log(
    "============================================================"
  );
  
  console.log(
    "FINAL MODEL SCORECARD"
  );
  
  console.log(
    "============================================================"
  );
  
  console.log(
    "Higher wins/podiums = stronger overall evidence."
  );
  
  console.log(
    "This scorecard is descriptive, NOT a statistical significance test."
  );
  
  console.log("");
  
  for (
    const model of
    models
  ) {
    console.log(
      `${model.padEnd(6)} | ` +
      `Wins=${String(
        scorecard[model].wins
      ).padStart(2)} | ` +
      `Podiums=${String(
        scorecard[model].podiums
      ).padStart(2)}`
    );
  }
  
  // ============================================================
  // KEY AGGREGATE METRICS
  // ============================================================
  
  console.log("\n");
  console.log(
    "============================================================"
  );
  
  console.log(
    "KEY METRIC AVERAGES"
  );
  
  console.log(
    "============================================================"
  );
  
  for (
    const model of
    models
  ) {
    const accuracyValues = [
      exp9[model].accuracy,
      exp15[model].accuracy,
      exp16[model].accuracy,
      exp17[model].accuracy,
  
      ...Object.values(
        exp19
      ).map(
        scenario =>
          scenario[model].accuracy
      )
    ];
  
    const maeValues = [
      exp9[model].mae,
      exp15[model].mae,
      exp17[model].mae,
  
      ...Object.values(
        exp19
      ).map(
        scenario =>
          scenario[model].mae
      )
    ];
  
    const brierValues = [
      exp9[model].brier,
      exp15[model].brier,
      exp16[model].brier,
      exp17[model].brier,
  
      ...Object.values(
        exp19
      ).map(
        scenario =>
          scenario[model].brier
      )
    ];
  
    console.log("\n");
    console.log(
      `MODEL: ${model}`
    );
  
    console.log(
      `Avg Accuracy : ${average(
        accuracyValues
      ).toFixed(2)}%`
    );
  
    console.log(
      `Avg MAE      : ${average(
        maeValues
      ).toFixed(4)}`
    );
  
    console.log(
      `Avg Brier    : ${average(
        brierValues
      ).toFixed(4)}`
    );
  }
  
  // ============================================================
  // FINAL CANDIDATE CHECK
  // ============================================================
  
  const candidate =
    scorecard["60:40"];
  
  const v02Score =
    scorecard["V0.2"];
  
  const v04Score =
    scorecard["V0.4"];
  
  console.log("\n");
  console.log(
    "============================================================"
  );
  
  console.log(
    "FINAL CANDIDATE CHECK"
  );
  
  console.log(
    "============================================================"
  );
  
  console.log(
    `60:40 wins   : ${candidate.wins}`
  );
  
  console.log(
    `V0.2 wins    : ${v02Score.wins}`
  );
  
  console.log(
    `V0.4 wins    : ${v04Score.wins}`
  );
  
  console.log("");
  
  if (
    candidate.wins >=
    v02Score.wins &&
    candidate.wins >=
    v04Score.wins
  ) {
    console.log(
      "60:40 remains the strongest aggregate candidate."
    );
  } else {
    console.log(
      "60:40 is NOT the strongest aggregate candidate."
    );
  }
  
  console.log("\n");
  console.log(
    "============================================================"
  );
  
  console.log(
    "EXPERIMENT #20 COMPLETE"
  );
  
  console.log(
    "============================================================"
  );
  
  console.log(
    "Production model: UNCHANGED"
  );
  
  console.log(
    "Database: NOT MODIFIED"
  );
  
  console.log(
    "Calibration layer: NOT PROMOTED"
  );
  
  console.log(
    "Next: Experiment #21 — Final Audit & Freeze"
  );
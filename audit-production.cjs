const Database = require('better-sqlite3');

const db = new Database('./football.db', {
  readonly: true
});

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function avg(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function fmt(value, digits = 4) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? 'N/A'
    : value.toFixed(digits);
}

try {
  const rows = db.prepare(`
    SELECT
      p.id AS prediction_id,
      p.match_id,
      p.model_version,
      p.home_prob,
      p.draw_prob,
      p.away_prob,
      p.predicted_home_goals,
      p.predicted_away_goals,
      p.predicted_result,
      m.home_team,
      m.away_team,
      m.competition,
      m.kickoff,
      m.status,
      m.home_score,
      m.away_score
    FROM predictions p
    JOIN matches m
      ON m.id = p.match_id
    WHERE p.id IN (
      SELECT MAX(p2.id)
      FROM predictions p2
      GROUP BY p2.match_id
    )
    AND p.model_version = 'ensemble_60_40'
    AND m.status = 'finished'
    AND m.home_score IS NOT NULL
    AND m.away_score IS NOT NULL
    ORDER BY m.kickoff ASC
  `).all();

  const valid = rows.filter(row => {
    const values = [
      row.home_prob,
      row.draw_prob,
      row.away_prob,
      row.predicted_home_goals,
      row.predicted_away_goals,
      row.home_score,
      row.away_score
    ];

    return values.every(value =>
      value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value))
    );
  });

  console.log('\n======================================');
  console.log(' FOOTBALL ANALYTICS LAB');
  console.log(' PRODUCTION BACKTEST AUDIT');
  console.log('======================================\n');

  console.log('Model                 : ensemble_60_40');
  console.log('Finished rows found   :', rows.length);
  console.log('Valid rows evaluated  :', valid.length);
  console.log('Rows skipped          :', rows.length - valid.length);

  if (valid.length === 0) {
    console.log(
      '\nTidak ada data valid untuk dievaluasi. ' +
      'Periksa status pertandingan, skor, dan model_version.'
    );
    process.exitCode = 1;
  } else {
    const confusion = {
      H: { H: 0, D: 0, A: 0 },
      D: { H: 0, D: 0, A: 0 },
      A: { H: 0, D: 0, A: 0 }
    };

    const actualCount = { H: 0, D: 0, A: 0 };
    const predictedCount = { H: 0, D: 0, A: 0 };

    let correct = 0;
    let brierSum = 0;
    let absoluteHomeError = 0;
    let absoluteAwayError = 0;
    let exactScoreCorrect = 0;
    let probabilitySumError = 0;

    const drawBins = [
      { label: '0–10%', min: 0, max: 0.10, n: 0, draws: 0 },
      { label: '10–20%', min: 0.10, max: 0.20, n: 0, draws: 0 },
      { label: '20–30%', min: 0.20, max: 0.30, n: 0, draws: 0 },
      { label: '30–40%', min: 0.30, max: 0.40, n: 0, draws: 0 },
      { label: '40–50%', min: 0.40, max: 0.50, n: 0, draws: 0 },
      { label: '50%+', min: 0.50, max: Infinity, n: 0, draws: 0 }
    ];

    const actualByPrediction = {
      H: { n: 0, correct: 0 },
      D: { n: 0, correct: 0 },
      A: { n: 0, correct: 0 }
    };

    for (const row of valid) {
      const homeScore = Number(row.home_score);
      const awayScore = Number(row.away_score);

      const actual =
        homeScore > awayScore ? 'H' :
        homeScore < awayScore ? 'A' : 'D';

      const predicted = row.predicted_result;
      const hp = Number(row.home_prob);
      const dp = Number(row.draw_prob);
      const ap = Number(row.away_prob);

      actualCount[actual]++;

      if (predictedCount[predicted] !== undefined) {
        predictedCount[predicted]++;
      }

      if (confusion[predicted]) {
        confusion[predicted][actual]++;
      }

      if (predicted === actual) {
        correct++;
      }

      if (actualByPrediction[predicted]) {
        actualByPrediction[predicted].n++;

        if (predicted === actual) {
          actualByPrediction[predicted].correct++;
        }
      }

      const actualH = actual === 'H' ? 1 : 0;
      const actualD = actual === 'D' ? 1 : 0;
      const actualA = actual === 'A' ? 1 : 0;

      brierSum +=
        (hp - actualH) ** 2 +
        (dp - actualD) ** 2 +
        (ap - actualA) ** 2;

      probabilitySumError += Math.abs(hp + dp + ap - 1);

      absoluteHomeError += Math.abs(
        Number(row.predicted_home_goals) - homeScore
      );

      absoluteAwayError += Math.abs(
        Number(row.predicted_away_goals) - awayScore
      );

      // Perkiraan skor exact menggunakan pembulatan expected goals.
      // Ini bukan most-likely score dari distribusi Poisson.
      const roundedHome = Math.round(Number(row.predicted_home_goals));
      const roundedAway = Math.round(Number(row.predicted_away_goals));

      if (roundedHome === homeScore && roundedAway === awayScore) {
        exactScoreCorrect++;
      }

      const bin = drawBins.find(item =>
        dp >= item.min && dp < item.max
      );

      if (bin) {
        bin.n++;
        if (actual === 'D') bin.draws++;
      }
    }

    const n = valid.length;
    const accuracy = correct / n;
    const brierMeanPerClass = brierSum / (n * 3);
    const brierMeanSum = brierSum / n;
    const homeMae = absoluteHomeError / n;
    const awayMae = absoluteAwayError / n;
    const overallGoalMae = (absoluteHomeError + absoluteAwayError) / (2 * n);

    console.log('\n--- 1X2 ACCURACY ---');
    console.log(`Benar             : ${correct}/${n}`);
    console.log(`Accuracy          : ${pct(accuracy)}`);

    console.log('\n--- ACTUAL RESULT DISTRIBUTION ---');
    for (const key of ['H', 'D', 'A']) {
      console.log(
        `${key}: ${actualCount[key]} (${pct(actualCount[key] / n)})`
      );
    }

    console.log('\n--- PREDICTED RESULT DISTRIBUTION ---');
    for (const key of ['H', 'D', 'A']) {
      console.log(
        `${key}: ${predictedCount[key]} (${pct(predictedCount[key] / n)})`
      );
    }

    console.log('\n--- CONFUSION MATRIX ---');
    console.log('Baris = prediksi, kolom = hasil aktual');
    console.log('             Actual H   Actual D   Actual A');
    for (const predicted of ['H', 'D', 'A']) {
      console.log(
        `Pred ${predicted.padEnd(5)} ${String(confusion[predicted].H).padStart(9)} ` +
        `${String(confusion[predicted].D).padStart(10)} ` +
        `${String(confusion[predicted].A).padStart(10)}`
      );
    }

    console.log('\n--- BRIER SCORE ---');
    console.log(
      'Multiclass Brier (sum of 3 classes):',
      fmt(brierMeanSum)
    );
    console.log(
      'Mean Brier per class (divided by 3):',
      fmt(brierMeanPerClass)
    );
    console.log(
      'Catatan: nilai lebih rendah lebih baik; bandingkan dengan baseline yang memakai definisi sama.'
    );

    console.log('\n--- GOAL ERROR ---');
    console.log('Home goals MAE       :', fmt(homeMae));
    console.log('Away goals MAE       :', fmt(awayMae));
    console.log('Overall goals MAE    :', fmt(overallGoalMae));
    console.log(
      'Rounded-goals exact score match:',
      `${exactScoreCorrect}/${n} (${pct(exactScoreCorrect / n)})`
    );
    console.log(
      'Catatan: exact score di sini memakai pembulatan expected goals, bukan skor Poisson paling mungkin.'
    );

    console.log('\n--- DRAW CALIBRATION ---');
    console.log('Bin       Samples   Actual draws   Actual draw rate');
    for (const bin of drawBins) {
      const rate = bin.n ? pct(bin.draws / bin.n) : 'N/A';

      console.log(
        `${bin.label.padEnd(9)} ${String(bin.n).padStart(7)} ` +
        `${String(bin.draws).padStart(13)} ${rate.padStart(17)}`
      );
    }

    console.log('\n--- ACCURACY BY PREDICTED CLASS ---');
    for (const key of ['H', 'D', 'A']) {
      const item = actualByPrediction[key];
      const rate = item.n ? pct(item.correct / item.n) : 'N/A';

      console.log(
        `${key}: predicted ${item.n}, correct ${item.correct}, accuracy ${rate}`
      );
    }

    console.log(
      '\nMean probability sum error:',
      fmt(probabilitySumError / n)
    );

    console.log('\n--- INTERPRETATION NOTES ---');
    console.log(
      '1. Accuracy saja tidak cukup untuk menilai kualitas probabilitas.'
    );
    console.log(
      '2. Draw calibration dengan sampel kecil atau bin kosong tidak konklusif.'
    );
    console.log(
      '3. Evaluasi ini hanya memakai latest prediction per match dengan model ensemble_60_40.'
    );
    console.log(
      '4. Rounded-goals exact score bukan metrik exact-score Poisson.'
    );
  }
} catch (error) {
  console.error('\nAudit gagal:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
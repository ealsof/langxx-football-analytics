const Database = require('better-sqlite3');

const db = new Database('./football.db', {
  readonly: true
});

try {
  console.log('\n=== PREDICTION MODEL HISTORY ===\n');

  const modelRows = db.prepare(`
    SELECT
      p.model_version,
      COUNT(*) AS prediction_count,
      SUM(
        CASE
          WHEN m.status = 'finished'
            AND m.home_score IS NOT NULL
            AND m.away_score IS NOT NULL
          THEN 1
          ELSE 0
        END
      ) AS finished_with_score,
      SUM(
        CASE
          WHEN m.status IN ('scheduled', 'timed')
          THEN 1
          ELSE 0
        END
      ) AS upcoming
    FROM predictions p
    JOIN matches m
      ON m.id = p.match_id
    GROUP BY p.model_version
    ORDER BY prediction_count DESC
  `).all();

  console.log('Distribusi berdasarkan model:');
  console.table(modelRows);

  console.log('\n=== LATEST PREDICTION PER MATCH ===\n');

  const latestRows = db.prepare(`
    SELECT
      p.model_version,
      m.status,
      COUNT(*) AS match_count
    FROM predictions p
    JOIN matches m
      ON m.id = p.match_id
    WHERE p.id IN (
      SELECT MAX(p2.id)
      FROM predictions p2
      GROUP BY p2.match_id
    )
    GROUP BY p.model_version, m.status
    ORDER BY p.model_version, m.status
  `).all();

  console.table(latestRows);

  console.log('\n=== FINISHED MATCHES WITH PREDICTIONS ===\n');

  const finishedRows = db.prepare(`
    SELECT
      p.model_version,
      m.home_team,
      m.away_team,
      m.home_score,
      m.away_score,
      m.kickoff,
      p.predicted_result,
      p.home_prob,
      p.draw_prob,
      p.away_prob,
      p.predicted_home_goals,
      p.predicted_away_goals,
      p.created_at
    FROM predictions p
    JOIN matches m
      ON m.id = p.match_id
    WHERE m.status = 'finished'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
    ORDER BY m.kickoff DESC
    LIMIT 15
  `).all();

  console.table(finishedRows);
} catch (error) {
  console.error('Pemeriksaan gagal:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
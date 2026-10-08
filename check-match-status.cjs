const Database = require('better-sqlite3');

const db = new Database('./football.db', {
  readonly: true
});

try {
  console.log('\n=== DISTRIBUSI STATUS PERTANDINGAN ===\n');

  const statuses = db.prepare(`
    SELECT
      status,
      COUNT(*) AS jumlah,
      SUM(
        CASE
          WHEN home_score IS NOT NULL
           AND away_score IS NOT NULL
          THEN 1
          ELSE 0
        END
      ) AS punya_skor
    FROM matches
    GROUP BY status
    ORDER BY jumlah DESC
  `).all();

  console.table(statuses);

  console.log('\n=== PERTANDINGAN YANG SUDAH MEMILIKI SKOR ===\n');

  const scoredMatches = db.prepare(`
    SELECT
      id,
      home_team,
      away_team,
      competition,
      kickoff,
      status,
      home_score,
      away_score
    FROM matches
    WHERE home_score IS NOT NULL
      AND away_score IS NOT NULL
    ORDER BY kickoff DESC
    LIMIT 15
  `).all();

  console.table(scoredMatches);

  console.log('\n=== STATUS SELESAI TANPA SKOR ===\n');

  const finishedWithoutScore = db.prepare(`
    SELECT
      id,
      home_team,
      away_team,
      competition,
      kickoff,
      status,
      home_score,
      away_score
    FROM matches
    WHERE status = 'finished'
      AND (
        home_score IS NULL
        OR away_score IS NULL
      )
    LIMIT 15
  `).all();

  console.table(finishedWithoutScore);

} catch (error) {
  console.error('Audit gagal:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
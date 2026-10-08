import Database from "better-sqlite3";

const db = new Database("football.db");

const rows = db.prepare(`
  SELECT
    competition,
    COUNT(*) AS finished,
    SUM(
      CASE
        WHEN home_score IS NOT NULL
         AND away_score IS NOT NULL
        THEN 1
        ELSE 0
      END
    ) AS with_scores
  FROM matches
  WHERE status = 'finished'
  GROUP BY competition
  ORDER BY competition;
`).all();

console.log(rows);

db.close();
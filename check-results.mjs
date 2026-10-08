import Database from "better-sqlite3";

const db = new Database("football.db");

const rows = db.prepare(`
  SELECT
    CASE
      WHEN home_score > away_score THEN 'Home Win'
      WHEN home_score = away_score THEN 'Draw'
      ELSE 'Away Win'
    END AS result,
    COUNT(*) AS jumlah
  FROM matches
  WHERE status = 'finished'
    AND home_score IS NOT NULL
    AND away_score IS NOT NULL
  GROUP BY result
  ORDER BY result;
`).all();

console.log(rows);

db.close();
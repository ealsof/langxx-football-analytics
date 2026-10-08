
import Database from "better-sqlite3";

const db = new Database("football.db", {
  readonly: true
});

try {
  const matches = db.prepare(`
    SELECT
      id,
      competition,
      kickoff,
      home_score,
      away_score
    FROM matches
    WHERE status = 'finished'
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
    ORDER BY kickoff ASC
  `).all();

  const summary = {};

  for (const match of matches) {
    const previousCount = db.prepare(`
      SELECT COUNT(*) AS total
      FROM matches
      WHERE status = 'finished'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL
        AND competition = ?
        AND kickoff < ?
    `).get(match.competition, match.kickoff).total;

    if (!summary[match.competition]) {
      summary[match.competition] = {
        finished: 0,
        eligible: 0,
        skipped: 0
      };
    }

    const s = summary[match.competition];
    s.finished++;

    if (previousCount >= 30) {
      s.eligible++;
    } else {
      s.skipped++;
    }
  }

  console.log("\n=== EVALUATION SAMPLE AUDIT ===\n");
  console.log("Competition | Finished | Eligible | Skipped");
  console.log("--------------------------------------------");

  for (const [competition, s] of Object.entries(summary)) {
    console.log(
      `${competition} | ${s.finished} | ${s.eligible} | ${s.skipped}`
    );
  }

  const totals = Object.values(summary).reduce(
    (acc, s) => ({
      finished: acc.finished + s.finished,
      eligible: acc.eligible + s.eligible,
      skipped: acc.skipped + s.skipped
    }),
    { finished: 0, eligible: 0, skipped: 0 }
  );

  console.log("--------------------------------------------");
  console.log(
    `TOTAL | ${totals.finished} | ${totals.eligible} | ${totals.skipped}`
  );

  console.log("\nMinimum historical matches: 30");
  console.log("Database opened in READ-ONLY mode.");
  console.log("No data or model settings were changed.\n");

} finally {
  db.close();
}
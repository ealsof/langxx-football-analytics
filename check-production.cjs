const Database = require('better-sqlite3');

const db = new Database('./football.db', {
  readonly: true
});

const rows = db.prepare(`
  SELECT
    p.id,
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
    m.status
  FROM predictions p
  JOIN matches m
    ON m.id = p.match_id
  WHERE p.id IN (
    SELECT MAX(p2.id)
    FROM predictions p2
    GROUP BY p2.match_id
  )
  AND p.model_version = 'ensemble_60_40'
  ORDER BY m.kickoff ASC
`).all();

console.log('\n=== PRODUCTION PREDICTION AUDIT ===\n');

console.log('Total production predictions:', rows.length);

const resultCount = {
  H: 0,
  D: 0,
  A: 0
};

for (const row of rows) {
  if (resultCount[row.predicted_result] !== undefined) {
    resultCount[row.predicted_result]++;
  }
}

console.log('\nDistribusi predicted_result:');
console.log(resultCount);

if (rows.length > 0) {
  console.log('\nPersentase:');

  for (const key of ['H', 'D', 'A']) {
    const pct = (resultCount[key] / rows.length) * 100;
    console.log(`${key}: ${pct.toFixed(2)}%`);
  }

  const avgHome =
    rows.reduce(
      (sum, row) => sum + Number(row.home_prob || 0),
      0
    ) / rows.length;

  const avgDraw =
    rows.reduce(
      (sum, row) => sum + Number(row.draw_prob || 0),
      0
    ) / rows.length;

  const avgAway =
    rows.reduce(
      (sum, row) => sum + Number(row.away_prob || 0),
      0
    ) / rows.length;

  console.log('\nRata-rata probabilitas:');
  console.log(`Home : ${(avgHome * 100).toFixed(2)}%`);
  console.log(`Draw : ${(avgDraw * 100).toFixed(2)}%`);
  console.log(`Away : ${(avgAway * 100).toFixed(2)}%`);

  const avgHomeGoals =
    rows.reduce(
      (sum, row) =>
        sum + Number(row.predicted_home_goals || 0),
      0
    ) / rows.length;

  const avgAwayGoals =
    rows.reduce(
      (sum, row) =>
        sum + Number(row.predicted_away_goals || 0),
      0
    ) / rows.length;

  console.log('\nRata-rata predicted goals:');
  console.log(`Home goals: ${avgHomeGoals.toFixed(3)}`);
  console.log(`Away goals: ${avgAwayGoals.toFixed(3)}`);

  console.log('\n10 pertandingan terdekat:');

  for (const row of rows.slice(0, 10)) {
    console.log(
      `${row.home_team} vs ${row.away_team} | ` +
      `${row.kickoff} | ` +
      `H ${(Number(row.home_prob) * 100).toFixed(1)}% | ` +
      `D ${(Number(row.draw_prob) * 100).toFixed(1)}% | ` +
      `A ${(Number(row.away_prob) * 100).toFixed(1)}% | ` +
      `${row.predicted_result}`
    );
  }
}

db.close();
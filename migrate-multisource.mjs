import Database from "better-sqlite3";

const db = new Database("football.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS match_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    provider_match_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, provider_match_id),
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );
`);

console.log("Tabel match_sources berhasil dibuat.");

const rows = db.prepare(`
  SELECT name, sql
  FROM sqlite_master
  WHERE type = 'table'
  AND name = 'match_sources'
`).all();

console.log(JSON.stringify(rows, null, 2));

db.close();

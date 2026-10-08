import Database from "better-sqlite3";

const db = new Database("football.db");

const rows = db.prepare(`
  SELECT name, sql
  FROM sqlite_master
  WHERE type = 'table'
  ORDER BY name
`).all();

console.log(JSON.stringify(rows, null, 2));

db.close();

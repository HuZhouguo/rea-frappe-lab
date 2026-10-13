'use strict';
/**
 * inspect.js — open a .books.db written by the repro with a plain SQLite
 * connection and dump the tables the voucher touches.
 *
 *   node run.js /tmp/jv.db && node inspect.js /tmp/jv.db
 */

const { DatabaseSync } = require('node:sqlite');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: node inspect.js <path-to.db>');
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((r) => r.name);

console.log('tables:', tables.join(', '));
console.log('');

for (const table of tables) {
  if (table.startsWith('sqlite_')) {
    continue;
  }
  const rows = db.prepare(`SELECT * FROM "${table}"`).all();
  console.log(`── ${table}  (${rows.length} row${rows.length === 1 ? '' : 's'})`);
  for (const row of rows) {
    console.log('   ' + JSON.stringify(row));
  }
  console.log('');
}

console.log('── JournalEntry DDL');
console.log(
  db
    .prepare("SELECT sql FROM sqlite_master WHERE name = 'JournalEntry'")
    .get().sql
);

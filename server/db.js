// The only thing this app writes to disk: one SQLite file in DATA_DIR.
//
// - journal_mode=DELETE: no -wal/-shm side files left lying around.
// - secure_delete=ON: deleted rows are zeroed, not just unlinked.
// - temp_store=MEMORY: SQLite's temporary tables never touch disk.
// The shred closes the database and deletes everything in DATA_DIR.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function openStore(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dir, 'otr.sqlite'));
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA secure_delete = ON;
    PRAGMA temp_store = MEMORY;
    CREATE TABLE IF NOT EXISTS session (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
  `);
  const select = db.prepare('SELECT json FROM session WHERE id = 1');
  const upsert = db.prepare(
    'INSERT INTO session (id, json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json',
  );
  let shredded = false;

  return {
    load() {
      const row = select.get();
      return row ? JSON.parse(row.json) : null;
    },
    save(state) {
      if (!shredded) upsert.run(JSON.stringify(state));
    },
    // Deletes the database and every other file in the data directory.
    // Returns what is left (always [] unless the filesystem refused).
    shred() {
      shredded = true;
      db.close();
      for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true });
      return readdirSync(dir);
    },
  };
}

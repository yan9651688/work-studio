import Database from 'better-sqlite3';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
const dir = process.env.DATA_DIR || '/app/data';
const backups = join(dir, 'backups');
await mkdir(backups, { recursive: true });
const database = new Database(join(dir, 'app.db'), { readonly: true });
const name = `app-${new Date().toISOString().replaceAll(':', '-')}.db`;
await database.backup(join(backups, name));
database.close();
const files = (await readdir(backups))
  .filter((name) => /^app-.*\.db$/.test(name))
  .sort()
  .reverse();
for (const old of files.slice(14)) await unlink(join(backups, old));
console.log(`SQLite backup complete: ${name}`);

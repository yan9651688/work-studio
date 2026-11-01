import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentTables } from './schema.js';
import type { Row, Generation } from '@studio/shared';

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();
const tableMap: Record<string, string> = {
  'model-groups': 'model_groups',
  'model-channels': 'model_channels',
  'home-entries': 'home_entries',
  docs: 'docs_pages',
  'recharge-plans': 'recharge_plans',
  'banned-words': 'banned_words',
  'banned-word-hits': 'banned_word_hits',
  'request-logs': 'request_logs',
  'stats-daily': 'stats_daily',
  'admin-audit': 'admin_audit',
  'credit-ledger': 'credit_ledger',
};
const allowed = new Set<string>([
  ...contentTables,
  'users',
  'sessions',
  'api_keys',
  'generations',
  'credit_ledger',
  'orders',
  'cdks',
  'assets',
]);
export function tableName(resource: string) {
  const t = tableMap[resource] || resource;
  if (!allowed.has(t)) throw new Error('Unknown table');
  return t;
}
export function openDb(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const sql = new Database(join(dir, 'app.db'));
  sql.pragma('journal_mode = WAL');
  sql.pragma('foreign_keys = ON');
  sql.pragma('busy_timeout = 5000');
  const orm = drizzle(sql);
  migrate(sql);
  function list<T = Row>(resource: string): T[] {
    return (
      sql.prepare(`SELECT * FROM ${tableName(resource)} ORDER BY created_at DESC`).all() as Record<
        string,
        unknown
      >[]
    ).map(decode) as T[];
  }
  function get<T = Row>(resource: string, id: string): T | undefined {
    const row = sql.prepare(`SELECT * FROM ${tableName(resource)} WHERE id=?`).get(id);
    return row ? (decode(row as Record<string, unknown>) as T) : undefined;
  }
  function put<T = Row>(
    resource: string,
    data: Record<string, unknown>,
    id = String(data.id || uid()),
  ): T {
    const t = tableName(resource);
    if (!contentTables.includes(t as (typeof contentTables)[number]))
      throw new Error('Use dedicated mutation for accounting tables');
    const existing = get(resource, id);
    const stamp = now();
    const record = {
      ...existing,
      ...data,
      id,
      created_at: existing?.created_at || stamp,
      updated_at: stamp,
    };
    sql
      .prepare(
        `INSERT INTO ${t}(id,data,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`,
      )
      .run(id, JSON.stringify(record), record.created_at, stamp);
    return record as T;
  }
  function settings(): Record<string, unknown> {
    return Object.fromEntries(
      (
        sql.prepare('SELECT key,value FROM site_settings').all() as {
          key: string;
          value: string;
        }[]
      ).map((r) => [r.key, JSON.parse(r.value)]),
    );
  }
  function setSetting(key: string, value: unknown) {
    sql
      .prepare(
        'INSERT INTO site_settings(key,value,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
      )
      .run(key, JSON.stringify(value), now(), now());
  }
  return { sql, orm, list, get, put, settings, setSetting };
}
export type DB = ReturnType<typeof openDb>;
function decode(row: Record<string, unknown>) {
  if (typeof row.data === 'string')
    return {
      ...JSON.parse(row.data),
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  for (const key of ['params', 'reference_assets', 'result_assets', 'allowed_models'])
    if (typeof row[key] === 'string') row[key] = JSON.parse(row[key] as string);
  return row;
}
export function getGeneration(db: DB, id: string) {
  return db.get<Generation>('generations', id);
}
function migrate(sql: Database.Database) {
  sql.exec(
    `CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);`,
  );
  if (sql.prepare('SELECT version FROM migrations WHERE version=1').get()) return;
  sql.transaction(() => {
    sql.exec(`
      CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,username TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',credits INTEGER NOT NULL DEFAULT 0 CHECK(credits>=0),status TEXT NOT NULL DEFAULT 'active',invite_code TEXT NOT NULL UNIQUE,invited_by TEXT,last_login_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,ip TEXT,ua TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE api_keys(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,key_prefix TEXT NOT NULL,key_hash TEXT NOT NULL UNIQUE,allowed_models TEXT NOT NULL DEFAULT '[]',quota_limit INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),enabled INTEGER NOT NULL DEFAULT 1,last_used_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE credit_ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),delta INTEGER NOT NULL,balance_after INTEGER NOT NULL,reason TEXT NOT NULL,ref_id TEXT,remark TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX ledger_refund_once ON credit_ledger(ref_id,reason) WHERE reason='refund';
      CREATE TABLE generations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),api_key_id TEXT,source TEXT NOT NULL,model_id TEXT NOT NULL,channel_id TEXT,type TEXT NOT NULL,prompt TEXT NOT NULL,params TEXT NOT NULL,reference_assets TEXT NOT NULL,status TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,result_assets TEXT NOT NULL DEFAULT '[]',error TEXT,cost_credits INTEGER NOT NULL,elapsed_ms INTEGER NOT NULL DEFAULT 0,is_public INTEGER NOT NULL DEFAULT 0,started_at TEXT,finished_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX generations_user_time ON generations(user_id,created_at DESC);
      CREATE INDEX generations_state ON generations(status,created_at);
      CREATE INDEX ledger_user_time ON credit_ledger(user_id,created_at DESC);
      CREATE TABLE orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),amount_cents INTEGER NOT NULL,credits INTEGER NOT NULL,channel TEXT NOT NULL DEFAULT 'manual',status TEXT NOT NULL DEFAULT 'pending',paid_at TEXT,out_trade_no TEXT UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE cdks(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,credits INTEGER NOT NULL,batch TEXT,used_by TEXT,used_at TEXT,expires_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE assets(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),path TEXT NOT NULL,thumb_path TEXT,mime TEXT NOT NULL,size INTEGER NOT NULL,width INTEGER,height INTEGER,sha256 TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE site_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    `);
    for (const t of contentTables)
      sql.exec(
        `CREATE TABLE ${t}(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
      );
    sql.prepare('INSERT INTO migrations VALUES(1,?)').run(now());
  })();
}

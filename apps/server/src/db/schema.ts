import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
const timestamps = {
  created_at: text().notNull(),
  updated_at: text().notNull(),
};
export const users = sqliteTable('users', {
  id: text().primaryKey(),
  email: text().notNull().unique(),
  username: text().notNull(),
  password_hash: text().notNull(),
  role: text().notNull().default('user'),
  credits: integer().notNull().default(0),
  status: text().notNull().default('active'),
  invite_code: text().notNull().unique(),
  invited_by: text(),
  last_login_at: text(),
  ...timestamps,
});
export const sessions = sqliteTable('sessions', {
  id: text().primaryKey(),
  user_id: text()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token_hash: text().notNull().unique(),
  expires_at: text().notNull(),
  ip: text(),
  ua: text(),
  ...timestamps,
});
export const apiKeys = sqliteTable('api_keys', {
  id: text().primaryKey(),
  user_id: text()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  key_prefix: text().notNull(),
  key_hash: text().notNull().unique(),
  allowed_models: text({ mode: 'json' }).notNull().default('[]'),
  quota_limit: integer().notNull().default(0),
  used: integer().notNull().default(0),
  enabled: integer().notNull().default(1),
  last_used_at: text(),
  ...timestamps,
});
export const generations = sqliteTable('generations', {
  id: text().primaryKey(),
  user_id: text()
    .notNull()
    .references(() => users.id),
  api_key_id: text(),
  source: text().notNull(),
  model_id: text().notNull(),
  channel_id: text(),
  type: text().notNull(),
  prompt: text().notNull(),
  params: text({ mode: 'json' }).notNull(),
  reference_assets: text({ mode: 'json' }).notNull(),
  status: text().notNull(),
  progress: integer().notNull().default(0),
  result_assets: text({ mode: 'json' }).notNull().default('[]'),
  error: text(),
  cost_credits: integer().notNull(),
  elapsed_ms: integer().notNull().default(0),
  is_public: integer().notNull().default(0),
  started_at: text(),
  finished_at: text(),
  ...timestamps,
});
export const creditLedger = sqliteTable('credit_ledger', {
  id: text().primaryKey(),
  user_id: text()
    .notNull()
    .references(() => users.id),
  delta: integer().notNull(),
  balance_after: integer().notNull(),
  reason: text().notNull(),
  ref_id: text(),
  remark: text(),
  ...timestamps,
});
export const orders = sqliteTable('orders', {
  id: text().primaryKey(),
  user_id: text()
    .notNull()
    .references(() => users.id),
  amount_cents: integer().notNull(),
  credits: integer().notNull(),
  channel: text().notNull().default('manual'),
  status: text().notNull().default('pending'),
  paid_at: text(),
  out_trade_no: text().unique(),
  ...timestamps,
});
export const cdks = sqliteTable('cdks', {
  id: text().primaryKey(),
  code: text().notNull().unique(),
  credits: integer().notNull(),
  batch: text(),
  used_by: text(),
  used_at: text(),
  expires_at: text(),
  ...timestamps,
});
export const assets = sqliteTable('assets', {
  id: text().primaryKey(),
  user_id: text().references(() => users.id),
  path: text().notNull(),
  thumb_path: text(),
  mime: text().notNull(),
  size: integer().notNull(),
  width: integer(),
  height: integer(),
  sha256: text().notNull(),
  ...timestamps,
});
export const siteSettings = sqliteTable('site_settings', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).notNull(),
  ...timestamps,
});
export const contentTables = [
  'channels',
  'models',
  'model_groups',
  'model_channels',
  'showcase',
  'home_entries',
  'docs_pages',
  'announcements',
  'updates',
  'apps',
  'skills',
  'banned_words',
  'banned_word_hits',
  'request_logs',
  'stats_daily',
  'admin_audit',
  'recharge_plans',
  'invites',
  'teams',
  'team_members',
  'team_wallet_ledger',
  'agents',
  'agent_sites',
  'agent_commissions',
  'agent_settlements',
  'agent_payout_requests',
  'agent_applications',
] as const;
export const contentSchemas = Object.fromEntries(
  contentTables.map((name) => [
    name,
    sqliteTable(name, {
      id: text().primaryKey(),
      data: text({ mode: 'json' }).notNull(),
      ...timestamps,
    }),
  ]),
);

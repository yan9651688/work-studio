import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { type Config, config } from './config.js';
import { openDb, now } from './db/index.js';
import { seed } from './db/seed.js';
import { Gateway } from './services/gateway/index.js';
import { assert, HttpError, hashToken } from './services/security.js';
import { authRoutes, safeUser } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { userRoutes } from './routes/user.js';
import { adminRoutes } from './routes/admin.js';
import { v1Routes } from './routes/v1.js';
import type { Context } from './context.js';
import type { Asset } from './services/storage.js';

export async function createApp(overrides: Partial<Config> = {}) {
  const cfg = config(overrides);
  assert(cfg.secret.length >= 32, 500, 'SECRET_REQUIRED', 'APP_SECRET 至少需要 32 个字符');
  const db = openDb(cfg.dataDir);
  await seed(db, cfg);
  const gateway = new Gateway(db, cfg);
  const app = Fastify({
    logger: cfg.logger
      ? {
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
        }
      : false,
    trustProxy: cfg.trustProxy,
    forceCloseConnections: true,
    bodyLimit: 1024 * 1024,
  });
  const ctx: Context = {
    db,
    config: cfg,
    gateway,
    user: (req) => {
      assert(req.account, 401, 'UNAUTHORIZED', '请先登录');
      return req.account;
    },
    admin: (req) => {
      assert(req.account, 401, 'UNAUTHORIZED', '请先登录');
      assert(req.account.role === 'admin', 403, 'FORBIDDEN', '需要管理员权限');
      return req.account;
    },
  };
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 180,
    timeWindow: '1 minute',
    allowList: cfg.testing ? () => true : undefined,
  });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 30 },
  });
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'same-origin')
      .header('x-frame-options', 'DENY');
    const bearer = req.headers.authorization?.match(/^Bearer (sk-[\w-]+)$/)?.[1];
    if (bearer) {
      const record = db.sql
        .prepare(
          'SELECT u.*,k.id AS api_key_id FROM users u JOIN api_keys k ON k.user_id=u.id WHERE k.key_hash=? AND k.enabled=1 AND u.status=?',
        )
        .get(hashToken(bearer), 'active') as Record<string, unknown> | undefined;
      if (record) {
        req.account = safeUser(record);
        req.apiKeyId = String(record.api_key_id);
      }
    } else if (req.cookies.studio_session) {
      const record = db.sql
        .prepare(
          'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.status=?',
        )
        .get(hashToken(req.cookies.studio_session), now(), 'active') as
        Record<string, unknown> | undefined;
      if (record) req.account = safeUser(record);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !bearer) {
      const origin = req.headers.origin;
      assert(
        !origin || origin === `${req.protocol}://${req.host}`,
        403,
        'INVALID_ORIGIN',
        '请求来源不匹配',
      );
      assert(
        req.headers['sec-fetch-site'] !== 'cross-site',
        403,
        'INVALID_ORIGIN',
        '不接受跨站请求',
      );
    }
    if (req.url.startsWith('/admin/api/manage/')) ctx.admin(req);
    if (
      req.url.startsWith('/api/') ||
      req.url.startsWith('/admin/api/') ||
      req.url.startsWith('/v1/')
    )
      reply.header('cache-control', 'no-store');
  });
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number; code?: string };
    const status = error instanceof ZodError ? 400 : err.statusCode || 500;
    const message =
      error instanceof ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')
        : status < 500 || err instanceof HttpError
          ? err.message
          : '服务器处理失败';
    if (status >= 500 && !cfg.testing)
      req.log.error({ code: err.code, message: err.message }, 'request failed');
    reply.code(status).send({ error: { code: err.code || 'VALIDATION_ERROR', message } });
  });
  authRoutes(app, ctx);
  publicRoutes(app, ctx);
  userRoutes(app, ctx);
  adminRoutes(app, ctx);
  v1Routes(app, ctx);
  app.get<{
    Params: { id: string; kind?: string };
    Querystring: { expires?: string; sig?: string };
  }>('/uploads/:id/:kind?', async (req, reply) => {
    const asset = db.get<Asset>('assets', req.params.id);
    assert(asset, 404, 'NOT_FOUND', '文件不存在');
    const publicGeneration = db.sql
      .prepare(
        "SELECT 1 FROM generations g, json_each(g.result_assets) a WHERE g.is_public=1 AND json_extract(a.value,'$.url') LIKE ? LIMIT 1",
      )
      .get(`%/uploads/${asset.id}?%`);
    const publicShowcase = db
      .list('showcase')
      .some((s) => s.enabled && String(s.image_url).includes(`/uploads/${asset.id}`));
    assert(
      asset.user_id === null ||
        req.account?.id === asset.user_id ||
        req.account?.role === 'admin' ||
        publicShowcase ||
        publicGeneration ||
        gateway.storage.authorized(asset.id, req.query.expires || '', req.query.sig || ''),
      403,
      'FORBIDDEN',
      '没有此文件的访问权限',
    );
    const thumb = req.params.kind === 'thumb' && asset.thumb_path;
    const path = join(cfg.dataDir, 'uploads', thumb || asset.path);
    assert(existsSync(path), 404, 'NOT_FOUND', '文件不存在');
    reply
      .header('cache-control', asset.user_id ? 'private, max-age=3600' : 'public, max-age=86400')
      .type(thumb ? 'image/jpeg' : asset.mime);
    return reply.send(createReadStream(path));
  });
  if (existsSync(cfg.webDir))
    await app.register(staticPlugin, { root: cfg.webDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (
      req.method === 'GET' &&
      !/^\/(api|admin\/api|v1|uploads|assets)(\/|$)/.test(req.url) &&
      existsSync(join(cfg.webDir, 'index.html'))
    )
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '页面或接口不存在' } });
  });
  app.addHook('onResponse', async (req, reply) => {
    if (
      req.account &&
      (req.url.startsWith('/v1/') ||
        (req.url.startsWith('/api/') && !req.url.endsWith('/stream') && req.method !== 'GET'))
    ) {
      const body = req.body as Record<string, unknown> | undefined;
      db.put('request-logs', {
        user_id: req.account.id,
        api_key_id: req.apiKeyId || null,
        route: req.routeOptions.url,
        model_id: typeof body?.model === 'string' ? body.model : body?.model_id || null,
        status_code: reply.statusCode,
        latency_ms: Math.round(reply.elapsedTime),
        ip: req.ip,
      });
    }
  });
  app.addHook('onClose', async () => {
    await gateway.close();
    db.sql.close();
  });
  db.sql.prepare('DELETE FROM sessions WHERE expires_at<?').run(now());
  gateway.start();
  return { app, ctx };
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Generation, Row } from '@studio/shared';
import { uid, now, tableName } from '../db/index.js';
import type { Context } from '../context.js';
import { assert, token, hashToken } from '../services/security.js';
import { changeCredits } from '../services/billing.js';

export function pagination(req: FastifyRequest) {
  return z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().max(200).default(''),
      sort: z.string().max(50).optional(),
      order: z.enum(['asc', 'desc']).default('desc'),
      status: z.string().optional(),
      model_id: z.string().optional(),
      user_id: z.string().optional(),
      channel_id: z.string().optional(),
      status_code: z.string().optional(),
    })
    .parse(req.query);
}
export function paged(rows: Row[], req: FastifyRequest) {
  const p = pagination(req);
  let filtered = rows.filter(
    (r) => !p.search || JSON.stringify(r).toLowerCase().includes(p.search.toLowerCase()),
  );
  for (const key of ['status', 'model_id', 'user_id', 'channel_id', 'status_code'] as const)
    if (p[key]) filtered = filtered.filter((r) => String(r[key]) === p[key]);
  if (p.sort)
    filtered.sort((a, b) => {
      const x = a[p.sort!],
        y = b[p.sort!];
      return (
        (typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x ?? '').localeCompare(String(y ?? ''))) * (p.order === 'asc' ? 1 : -1)
      );
    });
  return {
    data: filtered.slice((p.page - 1) * p.page_size, p.page * p.page_size),
    total: filtered.length,
    page: p.page,
    page_size: p.page_size,
  };
}
export function ownGeneration(ctx: Context, req: FastifyRequest, id: string) {
  const user = ctx.user(req);
  const g = ctx.db.get<Generation>('generations', id);
  assert(g && g.user_id === user.id, 404, 'NOT_FOUND', '生成记录不存在');
  return g;
}
export function freshGeneration(ctx: Context, g: Generation) {
  return {
    ...g,
    result_assets: g.result_assets.map((a) => {
      if (!a.url) return a;
      const id = a.url.match(/\/uploads\/([^/?]+)/)?.[1];
      return id
        ? {
            ...a,
            url: ctx.gateway.storage.url(id),
            thumb_url: a.thumb_url ? ctx.gateway.storage.url(id, true) : undefined,
          }
        : a;
    }),
  };
}
export async function upload(ctx: Context, req: FastifyRequest, publicAsset = false) {
  const user = ctx.user(req);
  const file = await req.file();
  assert(file, 400, 'FILE_REQUIRED', '请选择图片');
  const buffer = await file.toBuffer();
  assert(!file.file.truncated, 413, 'FILE_TOO_LARGE', '上传图片不能超过 10MB');
  return ctx.gateway.storage.save(buffer, publicAsset ? null : user.id);
}
export function userRoutes(app: FastifyInstance, ctx: Context) {
  const { db } = ctx;
  app.post(
    '/api/user/generations',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => ({ data: ctx.gateway.create(ctx.user(req), req.body) }),
  );
  app.get('/api/user/generations', async (req) => {
    const user = ctx.user(req);
    return paged(
      db
        .list<Generation>('generations')
        .filter((g) => g.user_id === user.id)
        .map((g) => freshGeneration(ctx, g)) as unknown as Row[],
      req,
    );
  });
  app.get<{ Params: { id: string } }>('/api/user/generations/:id', async (req) => ({
    data: freshGeneration(ctx, ownGeneration(ctx, req, req.params.id)),
  }));
  app.delete<{ Params: { id: string } }>('/api/user/generations/:id', async (req) => {
    const g = ownGeneration(ctx, req, req.params.id);
    assert(!['queued', 'running'].includes(g.status), 409, 'TASK_RUNNING', '任务进行中，不能删除');
    db.sql.prepare('DELETE FROM generations WHERE id=?').run(g.id);
    return { data: true };
  });
  app.put<{ Params: { id: string } }>('/api/user/generations/:id', async (req) => {
    const g = ownGeneration(ctx, req, req.params.id);
    const body = z.object({ is_public: z.boolean() }).parse(req.body);
    db.sql
      .prepare('UPDATE generations SET is_public=?,updated_at=? WHERE id=?')
      .run(body.is_public ? 1 : 0, now(), g.id);
    return { data: true };
  });
  app.get<{ Params: { id: string } }>('/api/user/generations/:id/stream', async (req, reply) => {
    ownGeneration(ctx, req, req.params.id);
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = () => {
      const g = db.get<Generation>('generations', req.params.id);
      if (!g) {
        reply.raw.end();
        return;
      }
      reply.raw.write(`data: ${JSON.stringify({ data: freshGeneration(ctx, g) })}\n\n`);
      if (['succeeded', 'refunded', 'failed'].includes(g.status)) reply.raw.end();
    };
    const timer = setInterval(send, 1000);
    reply.raw.on('close', () => clearInterval(timer));
    send();
  });
  app.post('/api/user/assets', async (req) => ({
    data: await upload(ctx, req),
  }));
  app.get('/api/user/api-keys', async (req) => {
    const user = ctx.user(req);
    return {
      data: db
        .list('api_keys')
        .filter((k) => k.user_id === user.id)
        .map(({ key_hash: _key, ...rest }) => rest),
    };
  });
  app.post('/api/user/api-keys', async (req) => {
    const user = ctx.user(req);
    const body = z
      .object({
        name: z.string().trim().min(1).max(60),
        allowed_models: z.array(z.string()).max(100).default([]),
        quota_limit: z.number().int().nonnegative().default(0),
      })
      .parse(req.body);
    const count = db.sql
      .prepare('SELECT count(*) n FROM api_keys WHERE user_id=?')
      .get(user.id) as { n: number };
    assert(count.n < 50, 400, 'KEY_LIMIT', '最多创建 50 个 API Key');
    const key = 'sk-' + token();
    const id = uid();
    db.sql
      .prepare(
        'INSERT INTO api_keys(id,user_id,name,key_prefix,key_hash,allowed_models,quota_limit,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        user.id,
        body.name,
        key.slice(0, 10),
        hashToken(key),
        JSON.stringify(body.allowed_models),
        body.quota_limit,
        now(),
        now(),
      );
    return { data: { id, key, name: body.name } };
  });
  app.delete<{ Params: { id: string } }>('/api/user/api-keys/:id', async (req) => {
    const user = ctx.user(req);
    db.sql
      .prepare('UPDATE api_keys SET enabled=0,updated_at=? WHERE id=? AND user_id=?')
      .run(now(), req.params.id, user.id);
    return { data: true };
  });
  for (const resource of ['credit-ledger', 'orders'])
    app.get(`/api/user/${resource}`, async (req) => {
      const user = ctx.user(req);
      return paged(
        db.list(resource).filter((r) => r.user_id === user.id),
        req,
      );
    });
  app.post('/api/user/recharge', async (req) => {
    const user = ctx.user(req);
    const body = z.object({ plan_id: z.string() }).parse(req.body);
    const plan = db.get('recharge-plans', body.plan_id);
    assert(plan?.enabled, 400, 'PLAN_UNAVAILABLE', '充值套餐不可用');
    const id = uid();
    db.sql
      .prepare(
        'INSERT INTO orders(id,user_id,amount_cents,credits,out_trade_no,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        id,
        user.id,
        Number(plan.price_cents),
        Number(plan.credits) + Number(plan.bonus || 0),
        `R${Date.now()}${token().slice(0, 6)}`,
        now(),
        now(),
      );
    return { data: db.get('orders', id) };
  });
  app.post(
    '/api/user/cdk/redeem',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const user = ctx.user(req);
      assert(db.settings().cdk_redeem_enabled, 403, 'REDEEM_DISABLED', '兑换暂未开放');
      const { code } = z.object({ code: z.string().trim().min(6).max(80) }).parse(req.body);
      const balance = db.sql.transaction(() => {
        const cdk = db.sql.prepare('SELECT * FROM cdks WHERE code=?').get(code) as
          | {
              id: string;
              credits: number;
              used_by: string | null;
              expires_at: string | null;
            }
          | undefined;
        assert(
          cdk && !cdk.used_by && (!cdk.expires_at || Date.parse(cdk.expires_at) > Date.now()),
          400,
          'INVALID_CDK',
          '兑换码无效、已使用或已过期',
        );
        const claimed = db.sql
          .prepare(
            'UPDATE cdks SET used_by=?,used_at=?,updated_at=? WHERE id=? AND used_by IS NULL',
          )
          .run(user.id, now(), now(), cdk.id);
        assert(claimed.changes, 409, 'CDK_USED', '兑换码已使用');
        return changeCredits(db, user.id, cdk.credits, 'cdk', cdk.id);
      })();
      return { data: { credits: balance } };
    },
  );
  app.get('/api/user/invite', async (req) => {
    const user = ctx.user(req);
    return {
      data: {
        invite_code: user.invite_code,
        invites: db
          .list('invites')
          .filter((i) => i.inviter_id === user.id)
          .map((i) => ({
            id: i.id,
            created_at: i.created_at,
            reward_credits: i.reward_credits,
          })),
      },
    };
  });
  app.put('/api/user/profile', async (req) => {
    const user = ctx.user(req);
    const { username } = z.object({ username: z.string().trim().min(1).max(40) }).parse(req.body);
    db.sql
      .prepare('UPDATE users SET username=?,updated_at=? WHERE id=?')
      .run(username, now(), user.id);
    return { data: true };
  });
  app.get('/api/user/logs', async (req) => {
    const user = ctx.user(req);
    return paged(
      db.list('request-logs').filter((r) => r.user_id === user.id),
      req,
    );
  });
  app.delete<{ Params: { id: string } }>('/api/user/orders/:id', async (req) => {
    const user = ctx.user(req);
    const result = db.sql
      .prepare(
        `UPDATE ${tableName('orders')} SET status='cancelled',updated_at=? WHERE id=? AND user_id=? AND status='pending'`,
      )
      .run(now(), req.params.id, user.id);
    assert(result.changes, 400, 'ORDER_UNAVAILABLE', '订单不可取消');
    return { data: true };
  });
}

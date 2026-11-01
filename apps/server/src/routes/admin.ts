import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import {
  resources,
  resourceSchema,
  type Model,
  type Channel,
  type Row,
  type Generation,
} from '@studio/shared';
import type { Context } from '../context.js';
import { uid, now, tableName } from '../db/index.js';
import { assert, encrypt, token } from '../services/security.js';
import { changeCredits } from '../services/billing.js';
import { testChannel } from '../services/gateway/adapters.js';
import { paged, upload, freshGeneration } from './user.js';
import { safeUser } from './auth.js';
import { stats, health } from './public.js';
import { RE2 } from 're2-wasm';
const siteSchema = z
  .object({
    title: z.string().min(1).max(80),
    subtitle: z.string().max(200),
    logo: z.string(),
    favicon: z.string(),
    avatar: z.string(),
    media_cdn_url: z.string(),
    contact: z.record(z.string()),
    register_enabled: z.boolean(),
    cdk_redeem_enabled: z.boolean(),
    default_credits: z.number().int().min(0).max(100000),
    invite_reward: z.number().int().min(0).max(10000),
    concurrency: z.number().int().min(1).max(20),
    retry_count: z.number().int().min(0).max(5),
    circuit_threshold: z.number().int().min(1).max(20),
    circuit_cooldown_seconds: z.number().int().min(5).max(3600),
    home_hero: z.object({
      eyebrow: z.string(),
      title: z.string(),
      subtitle: z.string(),
      placeholder: z.string(),
      image: z.string().optional(),
    }),
    footer: z.string(),
    seo: z.record(z.string()),
  })
  .partial()
  .strict();
export function adminRoutes(app: FastifyInstance, ctx: Context) {
  const { db, config } = ctx;
  const base = '/admin/api/manage';
  const audit = (req: FastifyRequest, action: string, target: string, diff: unknown = {}) =>
    db.put('admin-audit', {
      admin_id: ctx.admin(req).id,
      action,
      target,
      diff,
    });
  const redact = (resource: string, row: Row) =>
    resource === 'users'
      ? safeUser(row)
      : resource === 'channels'
        ? {
            ...row,
            api_key: '',
            key_hint: row.key_hint || '',
            has_key: !!row.api_key,
          }
        : resource === 'generations'
          ? freshGeneration(ctx, row as unknown as Generation)
          : row;
  app.get(`${base}/overview`, async (req) => {
    ctx.admin(req);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const generations = db.sql
      .prepare('SELECT count(*) n FROM generations WHERE created_at>=?')
      .get(start.toISOString()) as { n: number };
    const newUsers = db.sql
      .prepare('SELECT count(*) n FROM users WHERE created_at>=?')
      .get(start.toISOString()) as { n: number };
    const income = db.sql
      .prepare("SELECT coalesce(sum(amount_cents),0) n FROM orders WHERE status='paid'")
      .get() as { n: number };
    const daily = db.sql
      .prepare(
        "SELECT substr(created_at,1,10) date,count(*) count,sum(status='succeeded') success FROM generations WHERE created_at>=? GROUP BY substr(created_at,1,10)",
      )
      .all(new Date(Date.now() - 7 * 864e5).toISOString());
    return {
      data: {
        ...stats(ctx),
        today_generations: generations.n,
        new_users: newUsers.n,
        income_cents: income.n,
        health: health(ctx),
        daily,
        channels: db.list('channels').map((c) => ({
          id: c.id,
          name: c.name,
          enabled: c.enabled,
          last_check_ok: c.last_check_ok,
          last_check_at: c.last_check_at,
        })),
      },
    };
  });
  app.get(`${base}/settings`, async (req) => {
    ctx.admin(req);
    return { data: db.settings() };
  });
  app.put(`${base}/settings`, async (req) => {
    ctx.admin(req);
    const body = siteSchema.parse(req.body);
    db.sql.transaction(() => {
      for (const [key, value] of Object.entries(body)) db.setSetting(key, value);
      audit(req, 'settings.update', 'site', Object.keys(body));
    })();
    return { data: db.settings() };
  });
  app.post(`${base}/uploads`, async (req) => {
    ctx.admin(req);
    const data = await upload(ctx, req, true);
    audit(req, 'upload', data.id);
    return { data };
  });
  app.post(`${base}/stats/refresh`, async (req) => {
    audit(req, 'stats.refresh', 'stats');
    return { data: stats(ctx) };
  });
  app.post<{ Params: { id: string } }>(`${base}/channels/:id/test`, async (req) => {
    ctx.admin(req);
    const c = db.get<Channel>('channels', req.params.id);
    assert(c, 404, 'NOT_FOUND', '渠道不存在');
    const start = Date.now();
    let result: { ok: boolean; status: number };
    try {
      result = await testChannel(c, config.secret);
    } catch {
      result = { ok: false, status: 0 };
    }
    db.put('channels', { last_check_at: now(), last_check_ok: result.ok }, c.id);
    audit(req, 'channel.test', c.id);
    return { data: { ...result, elapsed_ms: Date.now() - start } };
  });
  app.post<{ Params: { id: string } }>(`${base}/models/:id/test`, async (req) => {
    const user = ctx.admin(req);
    const body = z
      .object({
        prompt: z.string().min(1).default('A simple green circle on a white background'),
      })
      .parse(req.body || {});
    const data = ctx.gateway.create(
      user,
      { model_id: req.params.id, prompt: body.prompt },
      undefined,
      'admin',
    );
    audit(req, 'model.test', req.params.id);
    return { data };
  });
  app.post(`${base}/cdks/batch`, async (req) => {
    ctx.admin(req);
    const body = z
      .object({
        count: z.number().int().min(1).max(500),
        credits: z.number().int().positive().max(1000000),
        batch: z.string().max(80).default(''),
        expires_at: z.string().datetime().nullable().default(null),
      })
      .parse(req.body);
    const data = db.sql.transaction(() =>
      Array.from({ length: body.count }, () => {
        const id = uid();
        const code = token().slice(0, 24).toUpperCase();
        db.sql
          .prepare(
            'INSERT INTO cdks(id,code,credits,batch,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(id, code, body.credits, body.batch, body.expires_at, now(), now());
        return { id, code };
      }),
    )();
    audit(req, 'cdk.batch', body.batch, {
      count: body.count,
      credits: body.credits,
    });
    return { data };
  });
  app.get(`${base}/cdks/export`, async (req, reply) => {
    ctx.admin(req);
    const cell = (v: unknown) =>
      '"' +
      String(v ?? '')
        .replace(/^[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    const rows = db.list('cdks');
    const csv = [
      'code,credits,batch,used_by,expires_at',
      ...rows.map((r) => [r.code, r.credits, r.batch, r.used_by, r.expires_at].map(cell).join(',')),
    ].join('\r\n');
    audit(req, 'cdk.export', 'cdks');
    return reply
      .header('content-disposition', 'attachment; filename="cdks.csv"')
      .type('text/csv; charset=utf-8')
      .send('\ufeff' + csv);
  });
  app.post<{ Params: { id: string } }>(`${base}/users/:id/credits`, async (req) => {
    ctx.admin(req);
    const { delta, remark } = z
      .object({
        delta: z.number().int().min(-10000000).max(10000000),
        remark: z.string().max(300).default(''),
      })
      .parse(req.body);
    assert(db.get('users', req.params.id), 404, 'NOT_FOUND', '用户不存在');
    const balance = db.sql.transaction(() => {
      const b = changeCredits(db, req.params.id, delta, 'admin', uid(), remark);
      audit(req, 'user.credits', req.params.id, { delta, remark });
      return b;
    })();
    return { data: { credits: balance } };
  });
  app.post<{ Params: { id: string } }>(`${base}/users/:id/password`, async (req) => {
    ctx.admin(req);
    const { password } = z.object({ password: z.string().min(12).max(128) }).parse(req.body);
    assert(db.get('users', req.params.id), 404, 'NOT_FOUND', '用户不存在');
    const hash = await argon2.hash(password);
    db.sql.transaction(() => {
      db.sql
        .prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?')
        .run(hash, now(), req.params.id);
      db.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id);
      audit(req, 'user.password.reset', req.params.id);
    })();
    return { data: true };
  });
  app.post<{ Params: { id: string } }>(`${base}/orders/:id/confirm`, async (req) => {
    ctx.admin(req);
    db.sql.transaction(() => {
      const order = db.get('orders', req.params.id);
      assert(order?.status === 'pending', 409, 'ORDER_NOT_PENDING', '订单不是待确认状态');
      const changed = db.sql
        .prepare(
          "UPDATE orders SET status='paid',paid_at=?,updated_at=? WHERE id=? AND status='pending'",
        )
        .run(now(), now(), order.id);
      assert(changed.changes, 409, 'ORDER_ALREADY_PAID', '订单已确认');
      changeCredits(db, String(order.user_id), Number(order.credits), 'recharge', order.id);
      const invitedUser = db.get('users', String(order.user_id));
      const invitation = db
        .list('invites')
        .find((i) => i.invitee_id === order.user_id && !i.rewarded_at);
      const reward = Number(db.settings().invite_reward || 0);
      if (invitedUser?.invited_by && invitation && reward > 0) {
        changeCredits(db, String(invitedUser.invited_by), reward, 'invite', invitation.id);
        db.put('invites', { reward_credits: reward, rewarded_at: now() }, invitation.id);
      }
      audit(req, 'order.confirm', order.id);
    })();
    return { data: true };
  });
  app.post<{ Params: { id: string } }>(`${base}/generations/:id/showcase`, async (req) => {
    ctx.admin(req);
    const g = db.get<Generation>('generations', req.params.id);
    assert(
      g?.status === 'succeeded' && g.result_assets[0]?.url && g.type === 'image',
      400,
      'INVALID_GENERATION',
      '仅可展示成功的图片作品',
    );
    const assetId = g.result_assets[0].url.match(/\/uploads\/([^/?]+)/)?.[1];
    assert(assetId, 400, 'INVALID_ASSET', '作品文件不存在');
    const data = db.put('showcase', {
      title: g.prompt.slice(0, 40),
      kind: 'bento',
      prompt: g.prompt,
      image_url: `/uploads/${assetId}`,
      enabled: true,
      weight: 0,
      span: 1,
    });
    db.sql.prepare('UPDATE generations SET is_public=1 WHERE id=?').run(g.id);
    audit(req, 'generation.showcase', g.id);
    return { data };
  });
  app.post<{ Params: { resource: string } }>(`${base}/:resource/reorder`, async (req) => {
    ctx.admin(req);
    const r = req.params.resource;
    assert(resources[r] && !resources[r].readonly, 400, 'INVALID_RESOURCE', '资源不支持排序');
    const { ids } = z.object({ ids: z.array(z.string()).max(200) }).parse(req.body);
    db.sql.transaction(() => {
      ids.forEach((id, i) => {
        assert(db.get(r, id), 404, 'NOT_FOUND', '记录不存在');
        db.put(r, { weight: ids.length - i }, id);
      });
      audit(req, 'reorder', r);
    })();
    return { data: true };
  });
  app.get<{ Params: { resource: string } }>(`${base}/:resource`, async (req) => {
    ctx.admin(req);
    const r = req.params.resource;
    assert(resources[r], 404, 'NOT_FOUND', '资源不存在');
    return paged(db.list(r).map((row) => redact(r, row)) as Row[], req);
  });
  app.get<{ Params: { resource: string; id: string } }>(`${base}/:resource/:id`, async (req) => {
    ctx.admin(req);
    const { resource: r, id } = req.params;
    assert(resources[r], 404, 'NOT_FOUND', '资源不存在');
    const record = db.get(r, id);
    assert(record, 404, 'NOT_FOUND', '记录不存在');
    return { data: redact(r, record) };
  });
  for (const method of ['POST', 'PUT'] as const)
    app.route<{ Params: { resource: string; id?: string } }>({
      method,
      url: `${base}/:resource${method === 'PUT' ? '/:id' : ''}`,
      handler: async (req) => {
        const admin = ctx.admin(req);
        const r = req.params.resource;
        const def = resources[r];
        assert(def && !def.readonly, 400, 'READ_ONLY', '此资源通过专用操作维护');
        const body = resourceSchema(r).parse(req.body);
        const existing = req.params.id ? db.get(r, req.params.id) : undefined;
        assert(!req.params.id || existing, 404, 'NOT_FOUND', '记录不存在');
        const values: Record<string, unknown> = {};
        if (!existing)
          for (const field of def.fields)
            values[field.key] =
              field.default ??
              (field.type === 'boolean'
                ? false
                : field.type === 'number'
                  ? 0
                  : field.type === 'json'
                    ? {}
                    : '');
        Object.assign(values, body);
        for (const field of def.fields.filter((f) => f.required))
          assert(
            String(values[field.key] ?? existing?.[field.key] ?? '').trim(),
            400,
            'FIELD_REQUIRED',
            `${field.label}不能为空`,
          );
        if (r === 'channels') {
          const url = new URL(String(values.base_url ?? existing?.base_url));
          assert(
            ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
            400,
            'INVALID_URL',
            '请输入有效的 HTTP / HTTPS 地址',
          );
          if (values.api_key) {
            values.key_hint = String(values.api_key).slice(-4);
            values.api_key = encrypt(String(values.api_key), config.secret);
          } else delete values.api_key;
          if (values.headers) z.record(z.string()).parse(values.headers);
          if (values.max_concurrency !== undefined)
            assert(
              Number(values.max_concurrency) >= 1 && Number(values.max_concurrency) <= 100,
              400,
              'INVALID_CONCURRENCY',
              '渠道并发需为 1–100',
            );
        }
        if (r === 'models') {
          for (const key of ['ratios', 'resolutions', 'image_qualities'])
            if (values[key] !== undefined) z.array(z.string()).parse(values[key]);
          if (values.durations !== undefined)
            z.array(z.number().positive()).parse(values.durations);
          for (const key of ['prices', 'text_pricing'])
            if (values[key] !== undefined)
              z.record(z.number().finite().nonnegative().max(10000000)).parse(values[key]);
        }
        if (r === 'model-channels') {
          assert(
            db.get<Model>('models', String(values.model_id ?? existing?.model_id)) &&
              db.get<Channel>('channels', String(values.channel_id ?? existing?.channel_id)),
            400,
            'INVALID_BINDING',
            '请选择已存在的模型与渠道',
          );
        }
        if (r === 'banned-words' && (values.match_type ?? existing?.match_type) === 'regex') {
          const pattern = String(values.word ?? existing?.word);
          assert(pattern.length <= 500, 400, 'UNSAFE_REGEX', '正则最多 500 个字符');
          try {
            new RE2(pattern, 'iu');
          } catch {
            assert(
              false,
              400,
              'INVALID_REGEX',
              '正则表达式无效（使用 RE2 语法，不支持回溯引用与前后查找）',
            );
          }
        }
        const id = req.params.id || String(body.id || uid());
        assert(existing || !db.get(r, id), 409, 'ID_EXISTS', '此 ID 已存在');
        if (r === 'users') {
          assert(existing, 400, 'USER_CREATE_UNSUPPORTED', '请通过注册接口创建账户');
          assert(
            id !== admin.id || (values.role !== 'user' && values.status !== 'banned'),
            400,
            'SELF_PROTECTION',
            '不能停用自己或移除自己的管理员权限',
          );
          db.sql.transaction(() => {
            for (const key of ['username', 'role', 'status'])
              if (values[key] !== undefined)
                db.sql
                  .prepare(`UPDATE users SET ${key}=?,updated_at=? WHERE id=?`)
                  .run(values[key], now(), id);
            if (values.status === 'banned')
              db.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
            audit(req, 'users.update', id, values);
          })();
        } else
          db.sql.transaction(() => {
            db.put(r, values, id);
            audit(
              req,
              `${r}.${existing ? 'update' : 'create'}`,
              id,
              Object.keys(values).filter((k) => !['api_key', 'headers'].includes(k)),
            );
          })();
        return { data: redact(r, db.get(r, id)!) };
      },
    });
  app.delete<{ Params: { resource: string; id: string } }>(`${base}/:resource/:id`, async (req) => {
    ctx.admin(req);
    const { resource: r, id } = req.params;
    assert(
      resources[r] &&
        ![
          'users',
          'credit-ledger',
          'orders',
          'request-logs',
          'admin-audit',
          'banned-word-hits',
        ].includes(r),
      400,
      'DELETE_UNSUPPORTED',
      '此资源不能直接删除',
    );
    const record = db.get(r, id);
    assert(record, 404, 'NOT_FOUND', '记录不存在');
    if (r === 'generations')
      assert(
        !['queued', 'running'].includes(String(record.status)),
        409,
        'TASK_RUNNING',
        '任务进行中',
      );
    if (r === 'cdks') assert(!record.used_by, 409, 'CDK_USED', '已使用的兑换码不可作废');
    if (r === 'models' || r === 'channels')
      assert(
        !db
          .list('model-channels')
          .some((b) => b[r === 'models' ? 'model_id' : 'channel_id'] === id),
        409,
        'RESOURCE_IN_USE',
        '请先解除模型绑定',
      );
    db.sql.transaction(() => {
      db.sql.prepare(`DELETE FROM ${tableName(r)} WHERE id=?`).run(id);
      audit(req, `${r}.delete`, id);
    })();
    return { data: true };
  });
}

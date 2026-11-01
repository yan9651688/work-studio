import type { FastifyInstance } from 'fastify';
import type { Context } from '../context.js';
import type { Generation, Model, Row } from '@studio/shared';
import { assert } from '../services/security.js';
import { now } from '../db/index.js';
export const sorted = (rows: Row[]) =>
  rows.sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
export function stats(ctx: Context) {
  const result = ctx.db.sql
    .prepare(
      "SELECT count(*) generated_count,coalesce(avg(elapsed_ms),0) avg_elapsed_ms FROM generations WHERE status='succeeded'",
    )
    .get() as Record<string, number>;
  const recent = ctx.db.sql
    .prepare(
      "SELECT count(*) count,coalesce(avg(elapsed_ms),0) avg_elapsed_ms FROM generations WHERE status='succeeded' AND created_at>=?",
    )
    .get(new Date(Date.now() - 864e5).toISOString()) as Record<string, number>;
  const size = ctx.db.sql.prepare('SELECT coalesce(sum(size),0) n FROM assets').get() as {
    n: number;
  };
  return {
    ...result,
    avg_elapsed_ms_24h: recent.avg_elapsed_ms,
    generated_size_bytes: size.n,
    recent: recent.count,
    refreshing: false,
    updated_at: now(),
  };
}
export function health(ctx: Context) {
  const since = new Date(Date.now() - 864e5).toISOString();
  const rows = ctx.db.sql
    .prepare('SELECT model_id,status,elapsed_ms,created_at FROM generations WHERE created_at>=?')
    .all(since) as Generation[];
  return ctx.db
    .list<Model>('models')
    .filter((m) => m.enabled)
    .map((model) => {
      const records = rows.filter((g) => g.model_id === model.id);
      const done = records.filter((g) => ['succeeded', 'failed', 'refunded'].includes(g.status));
      const ok = done.filter((g) => g.status === 'succeeded');
      const recent = done.filter((g) => Date.parse(g.created_at) > Date.now() - 1800e3);
      const rate = recent.length
        ? recent.filter((g) => g.status === 'succeeded').length / recent.length
        : null;
      return {
        id: model.id,
        name: model.alias || model.name,
        type: model.type,
        health:
          rate === null ? 'unknown' : rate >= 0.95 ? 'healthy' : rate >= 0.7 ? 'busy' : 'error',
        success_rate: done.length ? ok.length / done.length : null,
        avg_elapsed_ms: ok.length ? ok.reduce((s, g) => s + g.elapsed_ms, 0) / ok.length : 0,
        count: done.length,
        hourly: Array.from({ length: 24 }, (_, i) => {
          const start = Date.now() - (24 - i) * 3600e3;
          const hour = done.filter(
            (g) => Date.parse(g.created_at) >= start && Date.parse(g.created_at) < start + 3600e3,
          );
          return {
            hour: new Date(start).toISOString(),
            count: hour.length,
            success: hour.filter((g) => g.status === 'succeeded').length,
          };
        }),
      };
    });
}
export function publicRoutes(app: FastifyInstance, ctx: Context) {
  const { db } = ctx;
  app.get('/healthz', async () => ({
    status: 'ok',
    database: db.sql.prepare('SELECT 1').get() ? 'ok' : 'error',
  }));
  app.get('/admin/api/site', async () => {
    const settings = db.settings();
    return {
      data: Object.fromEntries(
        [
          'title',
          'subtitle',
          'logo',
          'favicon',
          'avatar',
          'contact',
          'media_cdn_url',
          'register_enabled',
          'cdk_redeem_enabled',
          'home_hero',
          'footer',
          'seo',
        ].map((key) => [key, settings[key]]),
      ),
    };
  });
  app.get('/admin/api/stats', async () => ({ data: stats(ctx) }));
  app.get('/admin/api/managed-models', async () => ({
    data: sorted(db.list('models').filter((m) => m.enabled)),
  }));
  app.get('/admin/api/model-groups', async () => ({
    data: sorted(db.list('model-groups')),
  }));
  app.get('/admin/api/home-entries', async () => ({
    data: sorted(db.list('home-entries')),
  }));
  app.get('/admin/api/showcase', async () => {
    const rows = sorted(db.list('showcase').filter((s) => s.enabled));
    return {
      data: {
        bento: rows.filter((s) => s.kind === 'bento'),
        inspiration: rows.filter((s) => s.kind === 'inspiration'),
      },
    };
  });
  app.get('/admin/api/status', async () => ({
    data: health(ctx),
    updated_at: now(),
  }));
  app.get('/admin/api/status/stream', async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = () =>
      reply.raw.write(`data: ${JSON.stringify({ data: health(ctx), updated_at: now() })}\n\n`);
    send();
    const timer = setInterval(send, 15000);
    reply.raw.on('close', () => clearInterval(timer));
  });
  for (const resource of ['docs', 'apps', 'skills', 'updates', 'recharge-plans'])
    app.get(`/admin/api/${resource}`, async () => ({
      data: sorted(
        db
          .list(resource)
          .filter((r) =>
            resource === 'docs'
              ? r.published
              : resource === 'skills' || resource === 'recharge-plans'
                ? r.enabled
                : true,
          ),
      ),
    }));
  app.get<{ Params: { slug: string } }>('/admin/api/docs/:slug', async (req) => {
    const doc = db.list('docs').find((d) => d.slug === req.params.slug && d.published);
    assert(doc, 404, 'NOT_FOUND', '文档不存在');
    return { data: doc };
  });
}

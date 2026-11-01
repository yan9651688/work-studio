import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { Generation, Model, User } from '@studio/shared';
import { createApp } from '../src/app.js';
import type { Context } from '../src/context.js';
import { mockUpstream } from './mock-upstream.js';
import { encrypt, decrypt, hashToken } from '../src/services/security.js';
import { changeCredits, refund } from '../src/services/billing.js';
import { uid, now, openDb } from '../src/db/index.js';
import { extract, template } from '../src/services/gateway/adapters.js';
let app: FastifyInstance,
  ctx: Context,
  dir: string,
  upstream: Awaited<ReturnType<typeof mockUpstream>>,
  adminCookie: string,
  userCookie: string,
  user: User,
  admin: User,
  otherCookie: string;
const password = 'Test-only-long-password-849!';
const secret = 'test-only-app-secret-01234567890123456789';
async function request(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  cookie = userCookie,
) {
  return app.inject({
    method,
    url,
    headers: cookie ? { cookie } : {},
    payload: body as Record<string, unknown> | undefined,
  });
}
async function done(id: string) {
  for (let i = 0; i < 100; i++) {
    const g = ctx.db.get<Generation>('generations', id)!;
    if (['succeeded', 'refunded', 'failed'].includes(g.status)) return g;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Generation did not settle');
}
function configure(
  id: string,
  type: 'image' | 'text' | 'video' = 'image',
  provider: 'openai' | 'gemini' | 'custom-http' = 'openai',
  path = '/ok',
  config: Record<string, unknown> = {},
) {
  ctx.db.put(
    'channels',
    {
      name: id,
      provider_type: provider,
      base_url: upstream.url + path,
      api_key: encrypt('test-upstream-key', secret),
      headers: {},
      timeout_ms: 5000,
      max_concurrency: 1,
      weight: 1,
      enabled: true,
      config,
    },
    `ch-${id}`,
  );
  const model = {
    ...ctx.db.get<Model>('models', 'example-image-1')!,
    name: id,
    type,
    enabled: true,
    prices: { default: 8, '1K': 8 },
    resolutions: ['1K'],
    image_qualities: ['standard'],
    durations: type === 'video' ? [5] : [],
    text_pricing: {},
    image_to_image: true,
    max_reference_images: 2,
  };
  ctx.db.put('models', model, id);
  ctx.db.put(
    'model-channels',
    {
      model_id: id,
      channel_id: `ch-${id}`,
      upstream_model: 'mock-model',
      enabled: true,
      priority: 0,
      weight: 1,
      param_mapping: {},
    },
    `bind-${id}`,
  );
}
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'studio-test-'));
  upstream = await mockUpstream();
  ({ app, ctx } = await createApp({
    dataDir: dir,
    secret,
    adminEmail: 'admin@test.example',
    adminPassword: password,
    testing: true,
    logger: false,
  }));
  let res = await request('POST', '/api/auth/login', { email: 'admin@test.example', password }, '');
  expect(res.statusCode).toBe(200);
  adminCookie = res.cookies[0].name + '=' + res.cookies[0].value;
  admin = res.json().data;
  res = await request(
    'POST',
    '/api/auth/register',
    { email: 'creator@test.example', password, username: '测试创作者' },
    '',
  );
  expect(res.statusCode).toBe(200);
  userCookie = res.cookies[0].name + '=' + res.cookies[0].value;
  user = res.json().data;
  res = await request(
    'POST',
    '/api/auth/register',
    { email: 'other@test.example', password, username: '其他用户' },
    '',
  );
  otherCookie = res.cookies[0].name + '=' + res.cookies[0].value;
  ctx.db.sql.transaction(() => changeCredits(ctx.db, user.id, 10000, 'admin', uid()))();
  ctx.db.sql.transaction(() => changeCredits(ctx.db, admin.id, 10000, 'admin', uid()))();
});
afterAll(async () => {
  await app.close();
  await upstream.close();
  await rm(dir, { recursive: true, force: true });
});
describe('authentication and administration', () => {
  it('keeps the public model catalog accessible without a session', async () => {
    const res = await request('GET', '/admin/api/managed-models', undefined, '');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });
  it('isolates admin routes and hashes sessions', async () => {
    expect((await request('GET', '/admin/api/manage/channels', undefined, '')).statusCode).toBe(
      401,
    );
    expect((await request('GET', '/admin/api/manage/channels')).statusCode).toBe(403);
    const raw = userCookie.split('=')[1];
    expect(
      ctx.db.sql.prepare('SELECT id FROM sessions WHERE token_hash=?').get(raw),
    ).toBeUndefined();
    expect(
      ctx.db.sql.prepare('SELECT id FROM sessions WHERE token_hash=?').get(hashToken(raw)),
    ).toBeTruthy();
    const csrf = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: userCookie, origin: 'https://evil.example' },
    });
    expect(csrf.statusCode).toBe(403);
  });
  it('updates site content without exposing operational configuration', async () => {
    expect(
      (
        await request(
          'PUT',
          '/admin/api/manage/settings',
          { title: '测试工作台', default_credits: 3 },
          adminCookie,
        )
      ).statusCode,
    ).toBe(200);
    const site = (await request('GET', '/admin/api/site', undefined, '')).json().data;
    expect(site.title).toBe('测试工作台');
    expect(site.default_credits).toBeUndefined();
    expect(site.concurrency).toBeUndefined();
  });
  it('encrypts and preserves upstream secrets; audit contains no plaintext', async () => {
    const res = await request(
      'POST',
      '/admin/api/manage/channels',
      {
        name: 'Encrypted',
        base_url: upstream.url,
        provider_type: 'openai',
        api_key: 'sensitive-test-value',
        enabled: false,
      },
      adminCookie,
    );
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.api_key).toBe('');
    expect(data.key_hint).toBe('alue');
    const saved = ctx.db.get('channels', data.id)!;
    expect(saved.api_key).not.toBe('sensitive-test-value');
    expect(decrypt(String(saved.api_key), secret)).toBe('sensitive-test-value');
    await request(
      'PUT',
      `/admin/api/manage/channels/${data.id}`,
      { name: 'Updated', api_key: '' },
      adminCookie,
    );
    expect(ctx.db.get('channels', data.id)!.api_key).toBe(saved.api_key);
    expect(JSON.stringify(ctx.db.list('admin-audit'))).not.toContain('sensitive-test-value');
  });
  it('prevents role escalation, self lockout, and negative model prices', async () => {
    expect(
      (
        await request('PUT', `/admin/api/manage/users/${user.id}`, {
          role: 'admin',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await request('PUT', `/admin/api/manage/users/${admin.id}`, { role: 'user' }, adminCookie))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await request(
          'POST',
          '/admin/api/manage/models',
          { id: 'negative-price', name: 'Invalid', prices: { default: -20 } },
          adminCookie,
        )
      ).statusCode,
    ).toBe(400);
  });
});
describe('accounting and generation', () => {
  it('redeems a CDK exactly once', async () => {
    const made = await request(
      'POST',
      '/admin/api/manage/cdks/batch',
      { count: 1, credits: 42, batch: 'test' },
      adminCookie,
    );
    expect(made.statusCode).toBe(200);
    const code = made.json().data[0].code;
    const before = ctx.db.get<User>('users', user.id)!.credits;
    const [a, b] = await Promise.all([
      request('POST', '/api/user/cdk/redeem', { code }),
      request('POST', '/api/user/cdk/redeem', { code }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 400]);
    expect(ctx.db.get<User>('users', user.id)!.credits).toBe(before + 42);
  });
  it('confirms an order atomically and never credits it twice', async () => {
    const plan = ctx.db.put('recharge-plans', {
      name: 'Test',
      price_cents: 100,
      credits: 100,
      bonus: 5,
      enabled: true,
    });
    const order = await request('POST', '/api/user/recharge', {
      plan_id: plan.id,
    });
    const id = order.json().data.id;
    const before = ctx.db.get<User>('users', user.id)!.credits;
    expect(
      (await request('POST', `/admin/api/manage/orders/${id}/confirm`, {}, adminCookie)).statusCode,
    ).toBe(200);
    expect(
      (await request('POST', `/admin/api/manage/orders/${id}/confirm`, {}, adminCookie)).statusCode,
    ).toBe(409);
    expect(ctx.db.get<User>('users', user.id)!.credits).toBe(before + 105);
  });
  it('generates an image, debits once, stores a thumbnail, isolates history', async () => {
    configure('success');
    const before = ctx.db.get<User>('users', user.id)!.credits;
    const created = await request('POST', '/api/user/generations', {
      model_id: 'success',
      prompt: 'A green square',
    });
    expect(created.statusCode).toBe(200);
    const g = await done(created.json().data.id);
    expect(g.status).toBe('succeeded');
    expect(ctx.db.get<User>('users', user.id)!.credits).toBe(before - 8);
    expect(g.result_assets[0].thumb_url).toContain('/thumb');
    expect(
      (await request('GET', `/api/user/generations/${g.id}`, undefined, otherCookie)).statusCode,
    ).toBe(404);
    const assetId = g.result_assets[0].url!.match(/\/uploads\/([^/?]+)/)![1];
    expect((await request('GET', `/uploads/${assetId}`, undefined, otherCookie)).statusCode).toBe(
      403,
    );
    expect((await request('GET', g.result_assets[0].url!, undefined, '')).statusCode).toBe(200);
  });
  it('switches from a failed priority channel to the next channel', async () => {
    configure('retry', 'image', 'openai', '/fail');
    ctx.db.put(
      'model-channels',
      {
        model_id: 'retry',
        channel_id: 'ch-success',
        upstream_model: 'fallback',
        enabled: true,
        priority: 1,
        weight: 1,
        param_mapping: {},
      },
      'bind-fallback',
    );
    const before = ctx.db.get<User>('users', user.id)!.credits;
    const created = await request('POST', '/api/user/generations', {
      model_id: 'retry',
      prompt: 'retry',
    });
    const g = await done(created.json().data.id);
    expect(g.status).toBe('succeeded');
    expect(g.channel_id).toBe('ch-success');
    expect(ctx.db.get<User>('users', user.id)!.credits).toBe(before - 8);
  });
  it('refunds a completely failed request exactly once', async () => {
    configure('failure', 'image', 'openai', '/fail');
    const before = ctx.db.get<User>('users', user.id)!.credits;
    const res = await request('POST', '/api/user/generations', {
      model_id: 'failure',
      prompt: 'fail',
    });
    const g = await done(res.json().data.id);
    expect(g.status).toBe('refunded');
    expect(ctx.db.get<User>('users', user.id)!.credits).toBe(before);
    expect(refund(ctx.db, g.id, 'again')).toBe(false);
    expect(ctx.db.get<User>('users', user.id)!.credits).toBe(before);
    expect(
      ctx.db.list('credit-ledger').filter((l) => l.ref_id === g.id && l.reason === 'refund'),
    ).toHaveLength(1);
  });
  it('rejects unsupported parameters before reserving credits', async () => {
    const before = ctx.db.get<User>('users', user.id)!.credits;
    const res = await request('POST', '/api/user/generations', {
      model_id: 'success',
      prompt: 'test',
      params: { ratio: '100:1' },
    });
    expect(res.statusCode).toBe(400);
    expect(ctx.db.get<User>('users', user.id)!.credits).toBe(before);
  });
  it('runs Gemini and configurable HTTP adapters', async () => {
    configure('gemini', 'image', 'gemini', '/v1beta');
    configure('custom', 'image', 'custom-http', '', {
      path: '/custom',
      body: { description: '{{prompt}}' },
      response_path: '$.output.images[*].base64',
    });
    for (const model_id of ['gemini', 'custom']) {
      const res = await request('POST', '/api/user/generations', {
        model_id,
        prompt: 'adapter test',
      });
      expect((await done(res.json().data.id)).status).toBe('succeeded');
    }
  });
  it('polls custom asynchronous tasks', async () => {
    configure('poll', 'image', 'custom-http', '', {
      path: '/jobs',
      body: { prompt: '{{prompt}}' },
      task_id_path: 'task',
      poll_path: '/jobs/{{task_id}}',
      status_path: 'status',
      response_path: 'result[*]',
    });
    const res = await request('POST', '/api/user/generations', {
      model_id: 'poll',
      prompt: 'test async',
    });
    expect((await done(res.json().data.id)).status).toBe('succeeded');
  });
});
describe('external API and state recovery', () => {
  it('enforces API key model restrictions and quota', async () => {
    const keyRes = await request('POST', '/api/user/api-keys', {
      name: 'restricted',
      allowed_models: ['success'],
      quota_limit: 8,
    });
    const key = keyRes.json().data.key;
    expect(key).toMatch(/^sk-/);
    const send = (model: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/images/generations',
        headers: { authorization: `Bearer ${key}` },
        payload: { model, prompt: 'API image' },
      });
    expect((await send('custom')).statusCode).toBe(403);
    const ok = await send('success');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data[0].url).toContain('/uploads/');
    expect((await send('success')).statusCode).toBe(402);
    const listed = (await request('GET', '/api/user/api-keys')).json().data;
    expect(JSON.stringify(listed)).not.toContain(key);
    expect(JSON.stringify(listed)).not.toContain('key_hash');
  });
  it('returns compatible text completions and SSE events', async () => {
    configure('text', 'text');
    const key = (await request('POST', '/api/user/api-keys', { name: 'text' })).json().data.key;
    for (const stream of [false, true]) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: `Bearer ${key}` },
        payload: {
          model: 'text',
          messages: [{ role: 'user', content: 'Hello' }],
          stream,
        },
      });
      expect(res.statusCode).toBe(200);
      if (stream) {
        expect(res.body).toContain('data: [DONE]');
        expect(res.body).toContain('chat.completion.chunk');
      } else expect(res.json().choices[0].message.content).toContain('已验证');
    }
  });
  it('keeps accounting state after restart and refunds interrupted jobs', async () => {
    await app.close();
    const db = openDb(dir);
    const id = uid();
    const before = db.get<User>('users', user.id)!.credits;
    db.sql.transaction(() => {
      changeCredits(db, user.id, -8, 'generate', id);
      db.sql
        .prepare(
          "INSERT INTO generations(id,user_id,source,model_id,type,prompt,params,reference_assets,status,cost_credits,created_at,updated_at) VALUES(?,?,'studio','success','image','interrupted','{}','[]','running',8,?,?)",
        )
        .run(id, user.id, now(), now());
    })();
    db.sql.close();
    ({ app, ctx } = await createApp({
      dataDir: dir,
      secret,
      adminEmail: 'admin@test.example',
      adminPassword: password,
      testing: true,
      logger: false,
    }));
    expect(ctx.db.get<Generation>('generations', id)!.status).toBe('refunded');
    expect(ctx.db.get<User>('users', user.id)!.credits).toBe(before);
    expect(ctx.db.settings().title).toBe('测试工作台');
  });
  it('extracts arrays and substitutes typed values without evaluating code', () => {
    expect(extract({ data: [{ url: 'a' }, { url: 'b' }] }, '$.data[*].url')).toEqual(['a', 'b']);
    expect(
      template(
        { images: '{{images}}', prompt: '{{prompt}}' },
        { images: ['one'], prompt: '${process.exit()}' },
      ),
    ).toEqual({ images: ['one'], prompt: '${process.exit()}' });
  });
});

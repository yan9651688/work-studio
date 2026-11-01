import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { createApp } from '../src/app.js';
import { mockUpstream } from './mock-upstream.js';
import { changeCredits } from '../src/services/billing.js';
import { uid, now } from '../src/db/index.js';
import type { Model } from '@studio/shared';
const dir = await mkdtemp(join(tmpdir(), 'studio-http-test-'));
const upstream = await mockUpstream();
const { app, ctx } = await createApp({
  dataDir: dir,
  secret: 'e2e-only-secret-not-for-production-12345678',
  adminEmail: 'admin@e2e.example',
  adminPassword: 'E2e-only-password-123456!',
  testing: true,
  logger: false,
  webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
  publicBaseUrl: 'http://127.0.0.1:3100',
});
ctx.db.put(
  'channels',
  {
    name: '集成测试模拟上游',
    provider_type: 'openai',
    base_url: upstream.url,
    api_key: '',
    headers: {},
    timeout_ms: 5000,
    max_concurrency: 3,
    enabled: true,
    config: {},
  },
  'e2e-channel',
);
ctx.db.put(
  'models',
  {
    ...ctx.db.get<Model>('models', 'example-image-1'),
    id: 'e2e-image',
    name: '集成测试图像（模拟）',
    enabled: true,
    description: '仅供自动化与浏览器验收，生产环境不含此模型。',
    prices: { '1K': 8, '2K': 12 },
    image_to_image: true,
    max_reference_images: 3,
  },
  'e2e-image',
);
ctx.db.put(
  'model-channels',
  {
    model_id: 'e2e-image',
    channel_id: 'e2e-channel',
    upstream_model: 'mock',
    priority: 0,
    weight: 1,
    enabled: true,
    param_mapping: {},
  },
  'e2e-binding',
);
const id = uid();
ctx.db.sql
  .prepare(
    'INSERT INTO users(id,email,username,password_hash,invite_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
  )
  .run(
    id,
    'creator@e2e.example',
    '验收用户',
    await argon2.hash('E2e-only-password-123456!'),
    'E2E-CREATOR',
    now(),
    now(),
  );
ctx.db.sql.transaction(() => changeCredits(ctx.db, id, 1000, 'admin', uid()))();
const admin = ctx.db.sql.prepare("SELECT id FROM users WHERE role='admin'").get() as { id: string };
ctx.db.sql.transaction(() => changeCredits(ctx.db, admin.id, 1000, 'admin', uid()))();
await app.listen({ port: 3100, host: '127.0.0.1' });
console.log('Isolated HTTP test server ready at http://127.0.0.1:3100');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await upstream.close();
      await rm(dir, { recursive: true, force: true });
      process.exit(0);
    })();
  });

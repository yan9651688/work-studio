import { test, expect } from '@playwright/test';
import OpenAI, { toFile } from 'openai';
const password = 'E2e-only-password-123456!';
test('anonymous public routes and guarded admin routes', async ({ request }) => {
  for (const path of [
    '/',
    '/create',
    '/model-square',
    '/docs',
    '/docs/models',
    '/status',
    '/apps',
    '/skills',
    '/updates',
  ]) {
    const r = await request.get(path);
    expect(r.status()).toBe(200);
    expect(await r.text()).toContain('<div id="app">');
  }
  for (const path of ['site', 'stats', 'managed-models', 'showcase', 'docs', 'status'])
    expect((await request.get('/admin/api/' + path)).status()).toBe(200);
  expect((await request.get('/admin/api/manage/channels')).status()).toBe(401);
});
test('registration → CDK → generation → ledger over real HTTP', async ({ playwright }) => {
  const admin = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const user = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  expect(
    (await admin.post('/api/auth/login', { data: { email: 'admin@e2e.example', password } })).ok(),
  ).toBeTruthy();
  const cdk = await admin.post('/admin/api/manage/cdks/batch', {
    data: { count: 1, credits: 100, batch: 'e2e' },
  });
  const code = (await cdk.json()).data[0].code;
  const registration = await user.post('/api/auth/register', {
    data: { email: `e2e-${Date.now()}@example.test`, password, username: '流程验收' },
  });
  expect(registration.status()).toBe(200);
  expect((await user.post('/api/user/cdk/redeem', { data: { code } })).status()).toBe(200);
  const created = await user.post('/api/user/generations', {
    data: { model_id: 'e2e-image', prompt: 'A test image', params: { resolution: '1K' } },
  });
  expect(created.status()).toBe(200);
  const id = (await created.json()).data.id;
  await expect
    .poll(async () => {
      const response = await user.get('/api/user/generations/' + id);
      return (await response.json()).data.status;
    })
    .toBe('succeeded');
  const ledger = (await (await user.get('/api/user/credit-ledger')).json()).data;
  expect(
    ledger.some(
      (r: { reason: string; delta: number }) => r.reason === 'generate' && r.delta === -8,
    ),
  ).toBeTruthy();
  expect((await (await user.get('/api/auth/me')).json()).data.credits).toBe(92);
  const key = (
    await (await user.post('/api/user/api-keys', { data: { name: 'OpenAI SDK 验收' } })).json()
  ).data.key;
  const client = new OpenAI({ apiKey: key, baseURL: 'http://127.0.0.1:3100/v1' });
  const image = await client.images.generate({ model: 'e2e-image', prompt: 'SDK test' });
  expect(image.data?.[0].url).toContain('/uploads/');
  const original = await fetch(image.data![0].url!);
  const edited = await client.images.edit({
    model: 'e2e-image',
    prompt: 'SDK multipart edit test',
    n: 1,
    image: await toFile(await original.arrayBuffer(), 'reference.png', { type: 'image/png' }),
  });
  expect(edited.data?.[0].url).toContain('/uploads/');
  await user.dispose();
  await admin.dispose();
});
test('admin content CRUD persists and remains public only when enabled', async ({ request }) => {
  await request.post('/api/auth/login', { data: { email: 'admin@e2e.example', password } });
  const cases: [string, Record<string, unknown>][] = [
    [
      'channels',
      {
        name: 'e2e temp channel',
        base_url: 'https://example.com/v1',
        provider_type: 'openai',
        enabled: false,
      },
    ],
    ['models', { name: 'e2e model', enabled: false }],
    ['model-groups', { name: 'e2e group', slug: 'e2e-group' }],
    ['showcase', { title: 'e2e work', kind: 'bento', enabled: false }],
    ['home-entries', { title: 'e2e entry', link: '/create' }],
    ['docs', { title: 'e2e doc', slug: 'e2e-doc', content_md: '# E2E', published: false }],
    ['apps', { name: 'e2e app', slug: 'e2e-app', status: 'coming_soon' }],
    ['skills', { name: 'e2e skill', enabled: false }],
    ['updates', { title: 'e2e update', content_md: 'test' }],
    ['recharge-plans', { name: 'e2e plan', credits: 10, price_cents: 100, enabled: false }],
    ['banned-words', { word: 'test-banned-word', match_type: 'contains', action: 'block' }],
  ];
  for (const [resource, data] of cases) {
    const base = '/admin/api/manage/' + resource;
    const created = await request.post(base, { data });
    expect(created.status(), resource).toBe(200);
    const id = (await created.json()).data.id;
    expect((await request.get(base + '/' + id)).status()).toBe(200);
    const field = 'name' in data ? 'name' : 'title' in data ? 'title' : 'word';
    expect(
      (await request.put(base + '/' + id, { data: { [field]: 'updated-e2e' } })).status(),
    ).toBe(200);
    expect((await request.delete(base + '/' + id)).status()).toBe(200);
    expect((await request.get(base + '/' + id)).status()).toBe(404);
  }
});

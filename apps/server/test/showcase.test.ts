import { afterAll, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db/index.js';
import { fillShowcase, HERO_IMAGE } from '../src/db/showcase.js';

const dirs: string[] = [];
afterAll(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

describe('home showcase defaults', () => {
  it('fills legacy placeholders once and keeps admin edits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'studio-showcase-'));
    dirs.push(dir);
    const db = openDb(dir);
    db.setSetting('home_hero', { title: '标题', image: '' });
    db.put('showcase', { kind: 'bento', title: '创作留白 01', image_url: '' }, 'showcase-0');
    db.put('showcase', { kind: 'bento', title: '我的作品', image_url: '' }, 'showcase-1');
    db.put('showcase', { kind: 'inspiration', title: '自然光影', image_url: '' }, 'inspiration-0');

    expect(fillShowcase(db)).toBe(12);
    expect(db.settings().home_hero).toEqual({ title: '标题', image: HERO_IMAGE });
    expect(db.get('showcase', 'showcase-0')?.image_url).toBe('/showcase/work-1.jpg');
    expect(db.get('showcase', 'showcase-1')?.title).toBe('我的作品');
    expect(db.get('showcase', 'inspiration-0')?.title).toBe('游戏插画');
    expect(db.list('showcase')).toHaveLength(12);
    expect(fillShowcase(db)).toBe(0);
    db.sql.close();
  });
});

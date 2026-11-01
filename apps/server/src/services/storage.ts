import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import type { DB } from '../db/index.js';
import { now, uid } from '../db/index.js';
import type { Config } from '../config.js';
import { assert } from './security.js';
export interface Asset {
  id: string;
  user_id: string | null;
  path: string;
  thumb_path: string | null;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
}
export class Storage {
  constructor(
    readonly db: DB,
    readonly config: Config,
  ) {}
  signature(id: string, expires: string) {
    return createHmac('sha256', this.config.secret).update(`${id}:${expires}`).digest('hex');
  }
  authorized(id: string, expires: string, sig: string) {
    const expected = Buffer.from(this.signature(id, expires));
    const given = Buffer.from(sig);
    return (
      Number(expires) > Date.now() &&
      expected.length === given.length &&
      timingSafeEqual(expected, given)
    );
  }
  url(id: string, thumb = false) {
    const expires = String(Date.now() + 7 * 864e5);
    const base = String(this.db.settings().media_cdn_url || this.config.publicBaseUrl).replace(
      /\/$/,
      '',
    );
    return `${base}/uploads/${id}${thumb ? '/thumb' : ''}?expires=${expires}&sig=${this.signature(id, expires)}`;
  }
  async save(buffer: Buffer, userId: string | null, kind: 'image' | 'video' = 'image') {
    assert(buffer.length <= 50 * 1024 * 1024, 413, 'FILE_TOO_LARGE', '文件不能超过 50MB');
    let mime = 'image/png';
    let width: number | null = null;
    let height: number | null = null;
    let thumb: Buffer | undefined;
    if (kind === 'image') {
      const meta = await sharp(buffer, { limitInputPixels: 40_000_000 })
        .metadata()
        .catch(() => null);
      assert(
        meta && ['png', 'jpeg', 'webp', 'gif', 'avif'].includes(meta.format || ''),
        400,
        'INVALID_IMAGE',
        '仅支持 PNG、JPEG、WebP、GIF、AVIF 图片',
      );
      width = meta.width || null;
      height = meta.height || null;
      buffer = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().png().toBuffer();
      thumb = await sharp(buffer)
        .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
    } else {
      const mp4 = buffer.subarray(4, 8).toString() === 'ftyp';
      const webm = buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      assert(mp4 || webm, 400, 'INVALID_VIDEO', '上游未返回有效 MP4 / WebM 视频');
      mime = mp4 ? 'video/mp4' : 'video/webm';
    }
    const hash = createHash('sha256').update(buffer).digest('hex');
    const ext = kind === 'image' ? 'png' : mime === 'video/mp4' ? 'mp4' : 'webm';
    const relative = `${hash}.${ext}`;
    const dir = join(this.config.dataDir, 'uploads');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, relative), buffer, { mode: 0o600 });
    if (thumb)
      await writeFile(join(dir, relative + '.thumb.jpg'), thumb, {
        mode: 0o600,
      });
    const id = uid();
    const stamp = now();
    this.db.sql
      .prepare(
        'INSERT INTO assets(id,user_id,path,thumb_path,mime,size,width,height,sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        userId,
        relative,
        thumb ? relative + '.thumb.jpg' : null,
        mime,
        buffer.length,
        width,
        height,
        hash,
        stamp,
        stamp,
      );
    return {
      id,
      url: userId ? this.url(id) : `/uploads/${id}`,
      thumb_url: thumb ? (userId ? this.url(id, true) : `/uploads/${id}/thumb`) : undefined,
      mime,
      width,
      height,
    };
  }
  async read(id: string) {
    const asset = this.db.get<Asset>('assets', id);
    assert(asset, 404, 'ASSET_NOT_FOUND', '参考图不存在');
    return {
      asset,
      buffer: await readFile(join(this.config.dataDir, 'uploads', asset.path)),
    };
  }
}

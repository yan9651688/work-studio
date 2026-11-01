import type { Generation, Model } from '@studio/shared';
import { type DB, uid, now } from '../db/index.js';
import { assert } from './security.js';

export function changeCredits(
  db: DB,
  userId: string,
  delta: number,
  reason: string,
  refId: string,
  remark = '',
) {
  assert(Number.isSafeInteger(delta), 400, 'INVALID_CREDITS', '积分必须为整数');
  const result = db.sql
    .prepare('UPDATE users SET credits=credits+?,updated_at=? WHERE id=? AND credits+?>=0')
    .run(delta, now(), userId, delta);
  assert(result.changes, 402, 'INSUFFICIENT_CREDITS', '积分不足');
  const user = db.sql.prepare('SELECT credits FROM users WHERE id=?').get(userId) as {
    credits: number;
  };
  db.sql
    .prepare(
      'INSERT INTO credit_ledger(id,user_id,delta,balance_after,reason,ref_id,remark,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
    )
    .run(uid(), userId, delta, user.credits, reason, refId, remark, now(), now());
  return user.credits;
}
export function price(model: Model, params: Generation['params'], prompt: string) {
  let cost =
    model.prices[params.resolution || ''] ?? model.prices.default ?? Object.values(model.prices)[0];
  assert(Number.isFinite(cost) && cost >= 0, 400, 'PRICE_MISSING', '模型尚未配置有效价格');
  if (model.type === 'video' && model.video_billing_mode === 'per_second')
    cost *= params.duration || model.durations[0] || 5;
  const pricing = model.text_pricing;
  if (model.type === 'text' && pricing?.input_per_million !== undefined) {
    const input = Buffer.byteLength(JSON.stringify(params.messages || prompt), 'utf8');
    cost =
      (input * pricing.input_per_million +
        (params.max_tokens || 2048) * (pricing.output_per_million || 0)) /
      1e6;
  }
  if (params.thinking) cost += model.thinking_price || 0;
  return Math.ceil(cost);
}
export function refund(db: DB, id: string, error: string) {
  return db.sql.transaction(() => {
    const generation = db.get<Generation>('generations', id);
    if (!generation || !['queued', 'running'].includes(generation.status)) return false;
    changeCredits(db, generation.user_id, generation.cost_credits, 'refund', id);
    if (generation.api_key_id)
      db.sql
        .prepare('UPDATE api_keys SET used=MAX(0,used-?) WHERE id=?')
        .run(generation.cost_credits, generation.api_key_id);
    db.sql
      .prepare(
        'UPDATE generations SET status=?,error=?,progress=100,finished_at=?,updated_at=? WHERE id=?',
      )
      .run('refunded', error, now(), now(), id);
    return true;
  })();
}

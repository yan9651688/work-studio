import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import { z } from 'zod';
import { type User } from '@studio/shared';
import { uid, now } from '../db/index.js';
import { assert, token, hashToken } from '../services/security.js';
import { changeCredits } from '../services/billing.js';
import type { Context } from '../context.js';
const credentials = z.object({
  email: z
    .string()
    .email()
    .max(200)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(128),
  username: z.string().trim().min(1).max(40).optional(),
  invite_code: z.string().max(40).optional(),
});
export const safeUser = (user: Record<string, unknown>) =>
  ({
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    credits: user.credits,
    status: user.status,
    invite_code: user.invite_code,
    created_at: user.created_at,
    updated_at: user.updated_at,
  }) as User;
export function authRoutes(app: FastifyInstance, ctx: Context) {
  const { db, config } = ctx;
  const cookie = (request: FastifyRequest) => ({
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: request.protocol === 'https',
    maxAge: 7 * 86400,
  });
  function session(req: FastifyRequest, reply: FastifyReply, userId: string) {
    const value = token();
    db.sql
      .prepare(
        'INSERT INTO sessions(id,user_id,token_hash,expires_at,ip,ua,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        uid(),
        userId,
        hashToken(value),
        new Date(Date.now() + 7 * 864e5).toISOString(),
        req.ip,
        String(req.headers['user-agent'] || '').slice(0, 300),
        now(),
        now(),
      );
    reply.setCookie('studio_session', value, cookie(req));
    db.sql.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), userId);
  }
  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      assert(db.settings().register_enabled, 403, 'REGISTER_DISABLED', '注册暂未开放');
      const data = credentials.parse(req.body);
      assert(
        !db.sql.prepare('SELECT id FROM users WHERE email=?').get(data.email),
        409,
        'EMAIL_EXISTS',
        '此邮箱已注册',
      );
      const password = await argon2.hash(data.password);
      const id = uid();
      db.sql.transaction(() => {
        const inviter = data.invite_code
          ? (db.sql
              .prepare('SELECT id FROM users WHERE invite_code=? AND status=?')
              .get(data.invite_code, 'active') as { id: string } | undefined)
          : undefined;
        db.sql
          .prepare(
            'INSERT INTO users(id,email,username,password_hash,invite_code,invited_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
          )
          .run(
            id,
            data.email,
            data.username || data.email.split('@')[0],
            password,
            uid().slice(0, 8),
            inviter?.id || null,
            now(),
            now(),
          );
        const initial = Number(db.settings().default_credits || 0);
        if (initial) changeCredits(db, id, initial, 'register', id);
        if (inviter)
          db.put('invites', {
            inviter_id: inviter.id,
            invitee_id: id,
            reward_credits: 0,
          });
      })();
      session(req, reply, id);
      return { data: safeUser(db.get('users', id)!) };
    },
  );
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const data = credentials.parse(req.body);
      const user = db.sql.prepare('SELECT * FROM users WHERE email=?').get(data.email) as
        Record<string, unknown> | undefined;
      const valid = user
        ? await argon2.verify(String(user.password_hash), data.password)
        : await argon2.verify(await dummyHash, data.password);
      assert(user && valid, 401, 'INVALID_LOGIN', '邮箱或密码不正确');
      assert(user.status === 'active', 403, 'ACCOUNT_BANNED', '账户已停用');
      session(req, reply, String(user.id));
      return { data: safeUser(user) };
    },
  );
  app.get('/api/auth/me', async (req) => ({ data: req.account || null }));
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.cookies.studio_session)
      db.sql
        .prepare('DELETE FROM sessions WHERE token_hash=?')
        .run(hashToken(req.cookies.studio_session));
    reply.clearCookie('studio_session', { path: '/' });
    return { data: true };
  });
  app.post(
    '/api/auth/password',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const user = ctx.user(req);
      const data = z
        .object({
          current_password: z.string(),
          password: z.string().min(12).max(128),
        })
        .parse(req.body);
      const record = db.get('users', user.id)!;
      assert(
        await argon2.verify(String(record.password_hash), data.current_password),
        400,
        'WRONG_PASSWORD',
        '当前密码不正确',
      );
      const password = await argon2.hash(data.password);
      db.sql.transaction(() => {
        db.sql
          .prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?')
          .run(password, now(), user.id);
        db.sql.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      })();
      session(req, reply, user.id);
      return { data: true };
    },
  );
  const dummyHash = argon2.hash(config.secret);
}

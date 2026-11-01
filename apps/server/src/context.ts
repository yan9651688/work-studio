import type { FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '@studio/shared';
import type { DB } from './db/index.js';
import type { Config } from './config.js';
import type { Gateway } from './services/gateway/index.js';
export interface Context {
  db: DB;
  config: Config;
  gateway: Gateway;
  user: (req: FastifyRequest) => User;
  admin: (req: FastifyRequest) => User;
}
declare module 'fastify' {
  interface FastifyRequest {
    account?: User;
    apiKeyId?: string;
  }
}
export type Reply = FastifyReply;

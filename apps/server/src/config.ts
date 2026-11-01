import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyServerOptions } from 'fastify';
export interface Config {
  dataDir: string;
  secret: string;
  adminEmail: string;
  adminPassword: string;
  publicBaseUrl: string;
  webDir: string;
  logger: boolean;
  testing: boolean;
  trustProxy: FastifyServerOptions['trustProxy'];
}
export function config(overrides: Partial<Config> = {}): Config {
  const secret = process.env.APP_SECRET || '';
  return {
    dataDir: path.resolve(process.env.DATA_DIR || '../../data'),
    secret: secret || (overrides.testing ? randomBytes(32).toString('hex') : ''),
    adminEmail: process.env.ADMIN_EMAIL || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
    webDir: path.resolve(process.cwd().endsWith('/server') ? '../web/dist' : 'apps/web/dist'),
    logger: process.env.NODE_ENV !== 'test',
    testing: false,
    trustProxy: process.env.TRUST_PROXY === '1' ? (_address, hop) => hop === 0 : '127.0.0.1',
    ...overrides,
  };
}

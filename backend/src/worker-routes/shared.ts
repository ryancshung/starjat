import type { MiddlewareHandler } from 'hono';
import { verifyToken } from '../lib/auth';
import type { WorkerEnv } from '../lib/worker-prisma';
import type { createAuthTiming } from './auth-timing';

export type AuthUser = { userId: string; email: string; role: string; exp?: number };
export type WorkerVariables = { user: AuthUser; authTiming?: ReturnType<typeof createAuthTiming> };
export type WorkerRouteEnv = { Bindings: WorkerEnv; Variables: WorkerVariables };

export const authenticate: MiddlewareHandler<WorkerRouteEnv> = async (c, next) => {
  const authorization = c.req.header('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    c.get('authTiming')?.mark('T4_response_ready', { status: 401, outcome: 'missing_token' });
    return c.json({ error: '未提供認證令牌' }, 401);
  }
  try {
    c.set('user', verifyToken(authorization.slice(7), c.env.JWT_SECRET));
    await next();
  } catch {
    c.get('authTiming')?.mark('T4_response_ready', { status: 401, outcome: 'invalid_token' });
    return c.json({ error: '無效或過期的令牌' }, 401);
  }
};

export function requireRoles(...roles: string[]): MiddlewareHandler<WorkerRouteEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get('user').role)) {
      return c.json({ error: '權限不足' }, 403);
    }
    await next();
  };
}

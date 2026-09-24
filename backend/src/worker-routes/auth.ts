import { Hono } from 'hono';
import { z } from 'zod';
import { comparePassword, hashPassword, signToken } from '../lib/auth';
import { createPrisma, disconnectPrisma, type WorkerEnv } from '../lib/worker-prisma';
import { authenticate, type WorkerVariables } from './shared';
import { createAuthTiming, safeAuthError } from './auth-timing';

const registerSchema = z.object({
  email: z.string().email('無效的 Email'),
  password: z.string().min(6, '密碼至少 6 個字元'),
  name: z.string().min(1, '請輸入姓名'),
  role: z.enum(['PARENT', 'CHILD']).default('PARENT'),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function createAuthRoutes(getDb = createPrisma) {
const auth = new Hono<{ Bindings: WorkerEnv; Variables: WorkerVariables }>();

auth.use('/login', async (c, next) => {
  c.set('authTiming', createAuthTiming('login'));
  await next();
});
auth.use('/me', async (c, next) => {
  c.set('authTiming', createAuthTiming('me'));
  await next();
});

auth.post('/register', async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const body = parsed.data;
  const prisma = getDb(c.env.DATABASE_URL);
  try {
    const existing = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    if (existing) return c.json({ error: '此 Email 已被註冊' }, 400);

    let role: string = body.role;
    if ((await prisma.user.count()) === 0) role = 'ADMIN';

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        name: body.name,
        role,
      },
    });

    if (body.inviteCode) {
      const family = await prisma.family.findUnique({
        where: { inviteCode: body.inviteCode.toUpperCase() },
      });
      if (!family) {
        await prisma.user.delete({ where: { id: user.id } });
        return c.json({ error: '無效的邀請碼' }, 400);
      }
      await prisma.familyMember.create({ data: { familyId: family.id, userId: user.id } });
    }

    return c.json(
      {
        token: signToken(
          { userId: user.id, email: user.email, role: user.role },
          c.env.JWT_SECRET
        ),
        user: { id: user.id, email: user.email, name: user.name, role: user.role, points: user.points },
      },
      201
    );
  } catch (error) {
    console.error(error);
    return c.json({ error: '註冊失敗' }, 500);
  } finally {
    await prisma.$disconnect();
  }
});

auth.post('/login', async (c) => {
  const timing = c.get('authTiming')!;
  const parsed = loginSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    timing.mark('T4_response_ready', { status: 400, outcome: 'invalid_input' });
    return c.json({ error: parsed.error.errors[0].message }, 400);
  }

  const prisma = getDb(c.env.DATABASE_URL);
  try {
    timing.mark('T1_db_connect_start');
    await prisma.$connect();
    await prisma.$queryRawUnsafe('SELECT 1');
    timing.mark('T2_db_ready');
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    timing.mark('T3_sql_complete', { found: Boolean(user) });
    if (!user || !(await comparePassword(parsed.data.password, user.passwordHash))) {
      timing.mark('T4_response_ready', { status: 401, outcome: 'invalid_credentials' });
      return c.json({ error: 'Email 或密碼錯誤' }, 401);
    }
    const response = {
      token: signToken(
        { userId: user.id, email: user.email, role: user.role },
        c.env.JWT_SECRET
      ),
      user: { id: user.id, email: user.email, name: user.name, role: user.role, points: user.points },
    };
    timing.mark('T4_response_ready', { status: 200, outcome: 'success' });
    return c.json(response);
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth_error', route: 'login', requestId: timing.requestId, ...safeAuthError(error) }));
    timing.mark('T4_response_ready', { status: 500, outcome: 'error' });
    return c.json({ error: '登入失敗' }, 500);
  } finally {
    await disconnectPrisma(c, prisma);
  }
});

auth.get('/me', authenticate, async (c) => {
  const timing = c.get('authTiming')!;
  const prisma = getDb(c.env.DATABASE_URL);
  try {
    timing.mark('T1_db_connect_start');
    await prisma.$connect();
    await prisma.$queryRawUnsafe('SELECT 1');
    timing.mark('T2_db_ready');
    const user = await prisma.user.findUnique({
      where: { id: c.get('user').userId },
      select: {
        id: true, email: true, name: true, role: true, points: true, createdAt: true,
        memberships: { include: { family: { select: { id: true, name: true, inviteCode: true } } } },
      },
    });
    timing.mark('T3_sql_complete', { found: Boolean(user) });
    if (!user) {
      timing.mark('T4_response_ready', { status: 404, outcome: 'not_found' });
      return c.json({ error: '使用者不存在' }, 404);
    }
    const legacyTokenUpgraded = Boolean(c.get('user').exp);
    const response = { user, ...(legacyTokenUpgraded ? { token: signToken({ userId: user.id, email: user.email, role: user.role }, c.env.JWT_SECRET) } : {}) };
    timing.mark('T4_response_ready', { status: 200, outcome: 'success', legacyTokenUpgraded });
    return c.json(response);
  } catch (error) {
    console.error(JSON.stringify({ event: 'auth_error', route: 'me', requestId: timing.requestId, ...safeAuthError(error) }));
    timing.mark('T4_response_ready', { status: 500, outcome: 'error' });
    return c.json({ error: '取得使用者資料失敗' }, 500);
  } finally {
    await disconnectPrisma(c, prisma);
  }
});

return auth;
}

export default createAuthRoutes();

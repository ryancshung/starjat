import { Hono } from 'hono';
import { z } from 'zod';
import { comparePassword, hashPassword, signToken } from '../lib/auth';
import { createPrisma, type WorkerEnv } from '../lib/worker-prisma';
import { authenticate, type WorkerVariables } from './shared';

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

const auth = new Hono<{ Bindings: WorkerEnv; Variables: WorkerVariables }>();

auth.post('/register', async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const body = parsed.data;
  const prisma = createPrisma(c.env.DATABASE_URL);
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
          c.env.JWT_SECRET,
          c.env.JWT_EXPIRES_IN
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
  const parsed = loginSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (!user || !(await comparePassword(parsed.data.password, user.passwordHash))) {
      return c.json({ error: 'Email 或密碼錯誤' }, 401);
    }
    return c.json({
      token: signToken(
        { userId: user.id, email: user.email, role: user.role },
        c.env.JWT_SECRET,
        c.env.JWT_EXPIRES_IN
      ),
      user: { id: user.id, email: user.email, name: user.name, role: user.role, points: user.points },
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: '登入失敗' }, 500);
  } finally {
    await prisma.$disconnect();
  }
});

auth.get('/me', authenticate, async (c) => {
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const user = await prisma.user.findUnique({
      where: { id: c.get('user').userId },
      select: {
        id: true, email: true, name: true, role: true, points: true, createdAt: true,
        memberships: { include: { family: { select: { id: true, name: true, inviteCode: true } } } },
      },
    });
    return user ? c.json({ user }) : c.json({ error: '使用者不存在' }, 404);
  } catch (error) {
    console.error(error);
    return c.json({ error: '取得使用者資料失敗' }, 500);
  } finally {
    await prisma.$disconnect();
  }
});

export default auth;

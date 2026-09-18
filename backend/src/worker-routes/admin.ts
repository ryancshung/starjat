import { Hono } from 'hono';
import { z } from 'zod';
import { hashPassword } from '../lib/auth';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, requireRoles, type WorkerRouteEnv } from './shared';

export function createAdminRoutes(getDb = createPrisma) {
const admin = new Hono<WorkerRouteEnv>();

admin.get('/users', authenticate, requireRoles('ADMIN'), async (c) => {
  const prisma = getDb(c.env.DATABASE_URL);
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, points: true, createdAt: true, memberships: { include: { family: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return c.json({ users });
  } catch (error) { console.error(error); return c.json({ error: '取得使用者列表失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

admin.get('/families', authenticate, requireRoles('ADMIN'), async (c) => {
  const prisma = getDb(c.env.DATABASE_URL);
  try {
    const families = await prisma.family.findMany({
      include: { members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } }, _count: { select: { tasks: true, rewards: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return c.json({ families });
  } catch (error) { console.error(error); return c.json({ error: '取得家庭列表失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

admin.delete('/users/:id', authenticate, requireRoles('ADMIN'), async (c) => {
  if (c.req.param('id') === c.get('user').userId) return c.json({ error: '不能刪除自己' }, 400);
  const prisma = getDb(c.env.DATABASE_URL);
  try { await prisma.user.delete({ where: { id: c.req.param('id') } }); return c.json({ success: true }); }
  catch (error) { console.error(error); return c.json({ error: '刪除使用者失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

admin.put('/users/:id/password', authenticate, requireRoles('ADMIN'), async (c) => {
  const body = z.object({ password: z.string().min(6, '密碼至少 6 個字元').max(128, '密碼最多 128 個字元') }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  if (c.req.param('id') === c.get('user').userId) return c.json({ error: '請由其他管理者協助重設密碼' }, 400);
  const prisma = getDb(c.env.DATABASE_URL);
  try {
    const target = await prisma.user.findUnique({ where: { id: c.req.param('id') } });
    if (!target) return c.json({ error: '使用者不存在' }, 404);
    await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await hashPassword(body.data.password) } });
    return c.json({ success: true });
  } finally { await prisma.$disconnect(); }
});

admin.put('/users/:id/role', authenticate, requireRoles('ADMIN'), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !['ADMIN', 'PARENT', 'CHILD'].includes(body.role)) return c.json({ error: '無效的角色' }, 400);
  if (c.req.param('id') === c.get('user').userId) return c.json({ error: '不能修改自己的管理者角色' }, 400);
  const prisma = getDb(c.env.DATABASE_URL);
  try {
    const user = await prisma.user.update({ where: { id: c.req.param('id') }, data: { role: body.role }, select: { id: true, role: true } });
    return c.json({ user });
  } catch (error) { console.error(error); return c.json({ error: '更新角色失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

admin.put('/families/:id', authenticate, requireRoles('ADMIN'), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || !body.name.trim()) return c.json({ error: '請輸入家庭名稱' }, 400);
  const prisma = getDb(c.env.DATABASE_URL);
  try {
    const family = await prisma.family.update({ where: { id: c.req.param('id') }, data: { name: body.name.trim() } });
    return c.json({ family });
  } catch (error) { console.error(error); return c.json({ error: '更新家庭失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

admin.delete('/families/:id', authenticate, requireRoles('ADMIN'), async (c) => {
  const prisma = getDb(c.env.DATABASE_URL);
  try {
    await prisma.family.delete({ where: { id: c.req.param('id') } });
    return c.json({ success: true });
  } catch (error) { console.error(error); return c.json({ error: '刪除家庭失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

return admin;
}

export default createAdminRoutes();

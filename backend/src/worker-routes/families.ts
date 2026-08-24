import { Hono } from 'hono';
import { z } from 'zod';
import { generateInviteCode } from '../lib/auth';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, requireRoles, type WorkerRouteEnv } from './shared';

const families = new Hono<WorkerRouteEnv>();
const memberSelect = { id: true, name: true, email: true, role: true, points: true } as const;

families.post('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ name: z.string().min(1, '請輸入家庭名稱') }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const userId = c.get('user').userId;
    if (await prisma.familyMember.findFirst({ where: { userId } })) return c.json({ error: '您已經加入一個家庭' }, 400);
    let inviteCode = generateInviteCode();
    while (await prisma.family.findUnique({ where: { inviteCode } })) inviteCode = generateInviteCode();
    const family = await prisma.family.create({
      data: { name: body.data.name, inviteCode, members: { create: { userId } } },
      include: { members: { include: { user: { select: memberSelect } } } },
    });
    return c.json({ family }, 201);
  } catch (error) { console.error(error); return c.json({ error: '建立家庭失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

families.post('/join', authenticate, async (c) => {
  const body = z.object({ inviteCode: z.string().min(4, '請輸入邀請碼') }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const userId = c.get('user').userId;
    if (await prisma.familyMember.findFirst({ where: { userId } })) return c.json({ error: '您已經加入一個家庭' }, 400);
    const family = await prisma.family.findUnique({ where: { inviteCode: body.data.inviteCode.toUpperCase() } });
    if (!family) return c.json({ error: '無效的邀請碼' }, 404);
    await prisma.familyMember.create({ data: { familyId: family.id, userId } });
    const updated = await prisma.family.findUnique({ where: { id: family.id }, include: { members: { include: { user: { select: memberSelect } } } } });
    return c.json({ family: updated });
  } catch (error) { console.error(error); return c.json({ error: '加入家庭失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

families.get('/me', authenticate, async (c) => {
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const membership = await prisma.familyMember.findFirst({
      where: { userId: c.get('user').userId },
      include: { family: { include: { members: { include: { user: { select: memberSelect } } } } } },
    });
    return c.json({ family: membership?.family ?? null });
  } catch (error) { console.error(error); return c.json({ error: '取得家庭資料失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

families.put('/me', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ name: z.string().min(1, '請輸入家庭名稱').max(100) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const membership = await prisma.familyMember.findFirst({ where: { userId: c.get('user').userId } });
    if (!membership) return c.json({ error: '您尚未加入家庭' }, 404);
    const family = await prisma.family.update({ where: { id: membership.familyId }, data: { name: body.data.name } });
    return c.json({ family });
  } catch (error) { console.error(error); return c.json({ error: '更新家庭名稱失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

families.delete('/members/:userId', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const userId = c.get('user').userId;
    const targetUserId = c.req.param('userId');
    if (targetUserId === userId) return c.json({ error: '不能移除自己' }, 400);
    const mine = await prisma.familyMember.findFirst({ where: { userId } });
    if (!mine) return c.json({ error: '您不在任何家庭中' }, 403);
    const target = await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: targetUserId } });
    if (!target) return c.json({ error: '成員不存在' }, 404);
    await prisma.familyMember.delete({ where: { id: target.id } });
    return c.json({ success: true });
  } catch (error) { console.error(error); return c.json({ error: '移除成員失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

export default families;

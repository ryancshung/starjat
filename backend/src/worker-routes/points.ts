import { Hono } from 'hono';
import { z } from 'zod';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, requireRoles, type WorkerRouteEnv } from './shared';

const points = new Hono<WorkerRouteEnv>();

points.post('/award', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ userId: z.string().min(1), amount: z.number().int().positive('積分必須為正整數'), reason: z.string().min(1, '請填寫原因') }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const authorId = c.get('user').userId;
    const mine = await prisma.familyMember.findFirst({ where: { userId: authorId } });
    if (!mine) return c.json({ error: '您尚未加入家庭' }, 403);
    if (!await prisma.familyMember.findFirst({ where: { userId: body.data.userId, familyId: mine.familyId } })) return c.json({ error: '目標使用者不在您的家庭中' }, 403);
    const [user, transaction] = await prisma.$transaction([
      prisma.user.update({ where: { id: body.data.userId }, data: { points: { increment: body.data.amount } } }),
      prisma.pointTransaction.create({ data: { userId: body.data.userId, amount: body.data.amount, type: 'EARN', reason: body.data.reason, createdBy: authorId } }),
    ]);
    return c.json({ points: user.points, transaction }, 201);
  } catch (error) { console.error(error); return c.json({ error: '發放積分失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

points.get('/history', authenticate, async (c) => {
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const actor = c.get('user');
    const targetUserId = c.req.query('userId') ?? actor.userId;
    if (actor.role === 'CHILD' && targetUserId !== actor.userId) return c.json({ error: '只能查看自己的積分歷史' }, 403);
    if (['PARENT', 'ADMIN'].includes(actor.role) && targetUserId !== actor.userId) {
      const mine = await prisma.familyMember.findFirst({ where: { userId: actor.userId } });
      if (!await prisma.familyMember.findFirst({ where: { userId: targetUserId, familyId: mine?.familyId } })) return c.json({ error: '無權查看此使用者' }, 403);
    }
    const transactions = await prisma.pointTransaction.findMany({ where: { userId: targetUserId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return c.json({ transactions });
  } catch (error) { console.error(error); return c.json({ error: '取得歷史失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

points.get('/balance', authenticate, async (c) => {
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const user = await prisma.user.findUnique({ where: { id: c.get('user').userId }, select: { points: true } });
    return c.json({ points: user?.points ?? 0 });
  } catch (error) { console.error(error); return c.json({ error: '取得積分失敗' }, 500); }
  finally { await prisma.$disconnect(); }
});

export default points;

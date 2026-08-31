import { Hono } from 'hono';
import { z } from 'zod';
import { pointBalance, reservedPoints } from '../lib/reward-rules';
import { evaluateTrophies } from '../lib/trophies';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, requireRoles, type WorkerRouteEnv } from './shared';

const points = new Hono<WorkerRouteEnv>();

async function actorMembership(db: any, userId: string) {
  return db.familyMember.findFirst({ where: { userId }, include: { family: true } });
}

points.post('/award', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ userId: z.string().min(1), amount: z.number().int().positive('星星必須為正整數'), reason: z.string().trim().min(1, '請填寫原因') }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const authorId = c.get('user').userId;
    const mine = await actorMembership(db, authorId);
    if (!mine || !await db.familyMember.findFirst({ where: { userId: body.data.userId, familyId: mine.familyId } })) return c.json({ error: '目標使用者不在您的家庭中' }, 403);
    const result = await db.$transaction(async (tx: any) => {
      const before = await tx.user.findUnique({ where: { id: body.data.userId }, select: { points: true } });
      const user = await tx.user.update({ where: { id: body.data.userId }, data: { points: { increment: body.data.amount } } });
      const transaction = await tx.pointTransaction.create({ data: { userId: body.data.userId, amount: body.data.amount, type: 'EARN', reason: body.data.reason, createdBy: authorId, balanceBefore: before?.points ?? 0, balanceAfter: user.points } });
      return { user, transaction };
    });
    await evaluateTrophies(db, body.data.userId);
    return c.json({ points: result.user.points, transaction: result.transaction }, 201);
  } catch (error) { console.error(error); return c.json({ error: '發放星星失敗' }, 500); }
  finally { await db.$disconnect(); }
});

points.post('/deduct', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ userId: z.string().min(1), amount: z.number().int().positive('扣除數量必須為正整數'), reason: z.string().trim().min(1, '請填寫孩子能理解的原因') }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const authorId = c.get('user').userId;
    const mine = await actorMembership(db, authorId);
    if (!mine || (mine.family.ownerId !== authorId && !mine.canDeductPoints)) return c.json({ error: '家庭管理者尚未開啟您的扣星權限' }, 403);
    const target = await db.familyMember.findFirst({ where: { familyId: mine.familyId, userId: body.data.userId }, include: { user: true } });
    if (!target || target.user.role !== 'CHILD') return c.json({ error: '只能扣除同家庭孩子的星星' }, 403);
    const reserved = await reservedPoints(db, body.data.userId);
    try {
      const result = await db.$transaction(async (tx: any) => {
        const updated = await tx.user.updateMany({ where: { id: body.data.userId, points: { gte: body.data.amount + reserved } }, data: { points: { decrement: body.data.amount } } });
        if (updated.count !== 1) throw new Error('INSUFFICIENT_POINTS');
        const user = await tx.user.findUnique({ where: { id: body.data.userId }, select: { points: true } });
        const after = user?.points ?? 0;
        const transaction = await tx.pointTransaction.create({ data: { userId: body.data.userId, amount: -body.data.amount, type: 'DEDUCT', reason: body.data.reason, createdBy: authorId, balanceBefore: after + body.data.amount, balanceAfter: after } });
        return { transaction, points: after };
      });
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof Error && error.message === 'INSUFFICIENT_POINTS') return c.json({ error: '可用星星不足；待審兌換保留的星星不能扣除' }, 400);
      throw error;
    }
  } catch (error) { console.error(error); return c.json({ error: '扣除星星失敗' }, 500); }
  finally { await db.$disconnect(); }
});

points.post('/transactions/:id/reverse', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ reason: z.string().trim().min(1, '請填寫更正原因') }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const authorId = c.get('user').userId;
    const mine = await actorMembership(db, authorId);
    if (!mine || mine.family.ownerId !== authorId) return c.json({ error: '只有家庭管理者可以更正扣星' }, 403);
    const original = await db.pointTransaction.findUnique({ where: { id: c.req.param('id') } });
    if (!original || original.type !== 'DEDUCT' || !await db.familyMember.findFirst({ where: { familyId: mine.familyId, userId: original.userId } })) return c.json({ error: '找不到可更正的扣星紀錄' }, 404);
    if (await db.pointTransaction.findFirst({ where: { reversalOfId: original.id } })) return c.json({ error: '這筆扣星已經更正' }, 409);
    const amount = Math.abs(original.amount);
    const result = await db.$transaction(async (tx: any) => {
      const before = await tx.user.findUnique({ where: { id: original.userId }, select: { points: true } });
      const user = await tx.user.update({ where: { id: original.userId }, data: { points: { increment: amount } } });
      const transaction = await tx.pointTransaction.create({ data: { userId: original.userId, amount, type: 'REVERSAL', reason: body.data.reason, createdBy: authorId, balanceBefore: before?.points ?? 0, balanceAfter: user.points, reversalOfId: original.id } });
      return { points: user.points, transaction };
    });
    return c.json(result, 201);
  } finally { await db.$disconnect(); }
});

points.get('/history', authenticate, async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const actor = c.get('user');
    const targetUserId = c.req.query('userId') ?? actor.userId;
    if (actor.role === 'CHILD' && targetUserId !== actor.userId) return c.json({ error: '只能查看自己的星星紀錄' }, 403);
    if (targetUserId !== actor.userId) {
      const mine = await db.familyMember.findFirst({ where: { userId: actor.userId } });
      if (!mine || !await db.familyMember.findFirst({ where: { userId: targetUserId, familyId: mine.familyId } })) return c.json({ error: '無權查看此使用者' }, 403);
    }
    return c.json({ transactions: await db.pointTransaction.findMany({ where: { userId: targetUserId }, orderBy: { createdAt: 'desc' }, take: 200 }) });
  } finally { await db.$disconnect(); }
});

points.get('/balance', authenticate, async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try { return c.json(await pointBalance(db, c.get('user').userId)); }
  finally { await db.$disconnect(); }
});

export default points;

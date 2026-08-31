import { Hono } from 'hono';
import { z } from 'zod';
import { localParts, monthBounds } from '../lib/family-time';
import { pointBalance } from '../lib/reward-rules';
import { evaluateTrophies } from '../lib/trophies';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, requireRoles, type WorkerRouteEnv } from './shared';

const allowance = new Hono<WorkerRouteEnv>();

async function membership(db: any, userId: string) {
  return db.familyMember.findFirst({ where: { userId }, include: { family: true } });
}

allowance.get('/', authenticate, async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const actor = c.get('user');
    const mine = await membership(db, actor.userId);
    if (!mine) return c.json({ requests: [], settings: null });
    const parent = ['PARENT', 'ADMIN'].includes(actor.role);
    const requests = await db.allowanceRedemption.findMany({ where: { familyId: mine.familyId, ...(parent ? {} : { userId: actor.userId }) }, include: { user: { select: { id: true, name: true, points: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return c.json({ requests, settings: { pointsPerTwd: mine.family.pointsPerTwd, monthlyAllowanceLimitTwd: mine.monthlyAllowanceLimitTwd, timezone: mine.family.timezone } });
  } finally { await db.$disconnect(); }
});

allowance.post('/', authenticate, requireRoles('CHILD'), async (c) => {
  const parsed = z.object({ amountTwd: z.number().int().positive('金額必須為正整數') }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const userId = c.get('user').userId;
    const mine = await membership(db, userId);
    if (!mine?.family.pointsPerTwd) return c.json({ error: '家庭尚未設定零用錢兌換比例' }, 400);
    const local = localParts(new Date(), mine.family.timezone);
    const { start, end } = monthBounds(`${local.year}-${String(local.month).padStart(2, '0')}`, mine.family.timezone);
    const used = await db.allowanceRedemption.aggregate({ where: { userId, createdAt: { gte: start, lt: end }, status: { in: ['PENDING', 'APPROVED'] } }, _sum: { amountTwd: true } });
    if (mine.monthlyAllowanceLimitTwd && (used._sum.amountTwd ?? 0) + parsed.data.amountTwd > mine.monthlyAllowanceLimitTwd) return c.json({ error: `本月零用錢上限為 NT$${mine.monthlyAllowanceLimitTwd}` }, 400);
    const reserved = parsed.data.amountTwd * mine.family.pointsPerTwd;
    const balance = await pointBalance(db, userId);
    if (balance.availablePoints < reserved) return c.json({ error: '可用星星不足' }, 400);
    const request = await db.allowanceRedemption.create({ data: { familyId: mine.familyId, userId, amountTwd: parsed.data.amountTwd, pointsPerTwdSnapshot: mine.family.pointsPerTwd, reservedPoints: reserved } });
    return c.json({ request }, 201);
  } finally { await db.$disconnect(); }
});

allowance.post('/:id/cancel', authenticate, requireRoles('CHILD'), async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const changed = await db.allowanceRedemption.updateMany({ where: { id: c.req.param('id'), userId: c.get('user').userId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    if (!changed.count) return c.json({ error: '找不到可撤回的申請' }, 404);
    return c.json({ success: true });
  } finally { await db.$disconnect(); }
});

allowance.get('/pending', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    return c.json({ requests: mine ? await db.allowanceRedemption.findMany({ where: { familyId: mine.familyId, status: 'PENDING' }, include: { user: { select: { id: true, name: true, points: true } } }, orderBy: { createdAt: 'desc' } }) : [] });
  } finally { await db.$disconnect(); }
});

allowance.put('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '資料無效' }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const actorId = c.get('user').userId;
    const mine = await membership(db, actorId);
    const request = await db.allowanceRedemption.findUnique({ where: { id: c.req.param('id') } });
    if (!mine || !request || request.familyId !== mine.familyId) return c.json({ error: '無權審核' }, 403);
    try {
      await db.$transaction(async (tx: any) => {
        const claimed = await tx.allowanceRedemption.updateMany({ where: { id: request.id, status: 'PENDING' }, data: { status: parsed.data.status, reviewedAt: new Date(), reviewedBy: actorId } });
        if (!claimed.count) throw new Error('ALREADY_REVIEWED');
        if (parsed.data.status === 'APPROVED') {
          const paid = await tx.user.updateMany({ where: { id: request.userId, points: { gte: request.reservedPoints } }, data: { points: { decrement: request.reservedPoints } } });
          if (!paid.count) throw new Error('INSUFFICIENT_POINTS');
          const user = await tx.user.findUnique({ where: { id: request.userId }, select: { points: true } });
          await tx.pointTransaction.create({ data: { userId: request.userId, amount: -request.reservedPoints, type: 'SPEND', reason: `兌換零用錢：NT$${request.amountTwd}`, createdBy: actorId, balanceBefore: (user?.points ?? 0) + request.reservedPoints, balanceAfter: user?.points ?? 0 } });
        }
      });
      if (parsed.data.status === 'APPROVED') await evaluateTrophies(db, request.userId);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'ALREADY_REVIEWED') return c.json({ error: '申請已被處理' }, 409);
      if (error instanceof Error && error.message === 'INSUFFICIENT_POINTS') return c.json({ error: '孩子星星不足' }, 400);
      throw error;
    }
  } finally { await db.$disconnect(); }
});

export default allowance;

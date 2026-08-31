import { Hono } from 'hono';
import { z } from 'zod';
import { effectiveRewardCost, pointBalance, rewardAvailability } from '../lib/reward-rules';
import { evaluateTrophies } from '../lib/trophies';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, requireRoles, type WorkerRouteEnv } from './shared';

const rewards = new Hono<WorkerRouteEnv>();
const time = /^([01]\d|2[0-3]):[0-5]\d$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const inputBase = z.object({
  title: z.string().trim().min(1), description: z.string().nullable().optional(), cost: z.number().int().positive(),
  keepAfterRedemption: z.boolean().optional(), maxRedemptions: z.number().int().positive().nullable().optional(),
  discountPercent: z.number().int().min(1).max(99).nullable().optional(), discountStart: z.string().datetime().nullable().optional(), discountEnd: z.string().datetime().nullable().optional(),
  availabilityMode: z.enum(['ALWAYS', 'WEEKENDS', 'DATES', 'WEEKENDS_OR_DATES']).optional(),
  availableStartTime: z.string().regex(time).nullable().optional(), availableEndTime: z.string().regex(time).nullable().optional(),
  availableDates: z.array(z.string().regex(date)).max(100).optional(),
});
const validTimes = (value: { availableStartTime?: string | null; availableEndTime?: string | null }) => !value.availableStartTime || !value.availableEndTime || value.availableStartTime <= value.availableEndTime;
const input = inputBase.refine(validTimes, { message: '結束時間必須晚於開始時間' });
const updateInput = inputBase.partial().refine(validTimes, { message: '結束時間必須晚於開始時間' });

async function membership(db: any, userId: string) {
  return db.familyMember.findFirst({ where: { userId }, include: { family: true } });
}
const dateValues = (value: any) => ({ ...value, discountStart: value.discountStart ? new Date(value.discountStart) : value.discountStart, discountEnd: value.discountEnd ? new Date(value.discountEnd) : value.discountEnd });

rewards.get('/', authenticate, async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    if (!mine) return c.json({ rewards: [] });
    const now = new Date();
    const rows = await db.reward.findMany({ where: { familyId: mine.familyId, isActive: true }, include: { availableDates: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return c.json({ rewards: rows.map((reward: any) => ({ ...reward, effectiveCost: effectiveRewardCost(reward, now), availability: rewardAvailability(reward, mine.family.timezone, now) })) });
  } finally { await db.$disconnect(); }
});

rewards.post('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = input.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    if (!mine) return c.json({ error: '請先加入家庭' }, 400);
    const { availableDates = [], ...data } = parsed.data;
    const max = await db.reward.aggregate({ where: { familyId: mine.familyId }, _max: { sortOrder: true } });
    const reward = await db.reward.create({ data: { ...dateValues(data), familyId: mine.familyId, createdById: c.get('user').userId, keepAfterRedemption: data.keepAfterRedemption ?? true, availabilityMode: data.availabilityMode ?? 'ALWAYS', sortOrder: (max._max.sortOrder ?? -1) + 1, availableDates: { create: [...new Set(availableDates)].map((item) => ({ date: item })) } }, include: { availableDates: true } });
    return c.json({ reward }, 201);
  } finally { await db.$disconnect(); }
});

rewards.put('/discount/all', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = z.object({ percent: z.number().int().min(1).max(99).nullable(), start: z.string().datetime().nullable(), end: z.string().datetime().nullable() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '折扣資料無效' }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    if (!mine) return c.json({ error: '請先加入家庭' }, 400);
    await db.reward.updateMany({ where: { familyId: mine.familyId, isActive: true }, data: { discountPercent: parsed.data.percent, discountStart: parsed.data.start ? new Date(parsed.data.start) : null, discountEnd: parsed.data.end ? new Date(parsed.data.end) : null } });
    return c.json({ success: true });
  } finally { await db.$disconnect(); }
});

rewards.get('/wishes', authenticate, async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    const parent = ['PARENT', 'ADMIN'].includes(c.get('user').role);
    return c.json({ wishes: mine ? await db.wish.findMany({ where: { familyId: mine.familyId, ...(parent ? {} : { userId: c.get('user').userId }) }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }) : [] });
  } finally { await db.$disconnect(); }
});

rewards.post('/wishes', authenticate, async (c) => {
  const parsed = z.object({ title: z.string().trim().min(1).max(100), description: z.string().max(300).optional() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    if (!mine) return c.json({ error: '請先加入家庭' }, 400);
    return c.json({ wish: await db.wish.create({ data: { ...parsed.data, familyId: mine.familyId, userId: c.get('user').userId } }) }, 201);
  } finally { await db.$disconnect(); }
});

rewards.get('/redemptions/mine', authenticate, async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    return c.json({ redemptions: await db.rewardRedemption.findMany({ where: { userId: c.get('user').userId }, include: { reward: true }, orderBy: { createdAt: 'desc' }, take: 100 }) });
  } finally { await db.$disconnect(); }
});

rewards.put('/wishes/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = z.object({ status: z.enum(['APPROVED', 'REJECTED']), cost: z.number().int().positive().optional() }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '資料無效' }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    const wish = await db.wish.findFirst({ where: { id: c.req.param('id'), familyId: mine?.familyId, status: 'PENDING' } });
    if (!wish) return c.json({ error: '找不到待處理願望' }, 404);
    if (parsed.data.status === 'APPROVED') {
      if (!parsed.data.cost) return c.json({ error: '請填寫所需星星數' }, 400);
      const max = await db.reward.aggregate({ where: { familyId: mine!.familyId }, _max: { sortOrder: true } });
      await db.reward.create({ data: { familyId: mine!.familyId, createdById: c.get('user').userId, title: wish.title, description: wish.description, cost: parsed.data.cost, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
    }
    const updated = await db.wish.update({ where: { id: wish.id }, data: { status: parsed.data.status, reviewedAt: new Date(), reviewedBy: c.get('user').userId } });
    if (parsed.data.status === 'APPROVED') await evaluateTrophies(db, wish.userId);
    return c.json({ wish: updated });
  } finally { await db.$disconnect(); }
});

rewards.post('/:id/redeem', authenticate, requireRoles('CHILD'), async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    const reward = await db.reward.findUnique({ where: { id: c.req.param('id') }, include: { availableDates: true } });
    if (!mine || !reward || !reward.isActive) return c.json({ error: '獎勵不存在' }, 404);
    if (mine.familyId !== reward.familyId) return c.json({ error: '無權兌換' }, 403);
    const availability = rewardAvailability(reward, mine.family.timezone);
    if (!availability.available) return c.json({ error: availability.reason ?? '目前不可兌換' }, 400);
    if (reward.maxRedemptions && await db.rewardRedemption.count({ where: { rewardId: reward.id, status: 'APPROVED' } }) >= reward.maxRedemptions) return c.json({ error: '此獎勵已達兌換次數上限' }, 400);
    if (await db.rewardRedemption.findFirst({ where: { rewardId: reward.id, userId: c.get('user').userId, status: 'PENDING' } })) return c.json({ error: '已有待審核的兌換申請' }, 409);
    const cost = effectiveRewardCost(reward);
    const balance = await pointBalance(db, c.get('user').userId);
    if (balance.availablePoints < cost) return c.json({ error: '可用星星不足' }, 400);
    const redemption = await db.rewardRedemption.create({ data: { rewardId: reward.id, userId: c.get('user').userId, reservedPoints: cost, costSnapshot: cost, availabilitySnapshot: JSON.stringify(availability) } });
    return c.json({ redemption }, 201);
  } finally { await db.$disconnect(); }
});

rewards.post('/redemptions/:id/cancel', authenticate, requireRoles('CHILD'), async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const result = await db.rewardRedemption.updateMany({ where: { id: c.req.param('id'), userId: c.get('user').userId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    if (!result.count) return c.json({ error: '找不到可撤回的申請' }, 404);
    return c.json({ success: true });
  } finally { await db.$disconnect(); }
});

rewards.get('/pending', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    return c.json({ redemptions: mine ? await db.rewardRedemption.findMany({ where: { status: 'PENDING', reward: { familyId: mine.familyId } }, include: { reward: true, user: { select: { id: true, name: true, points: true } } }, orderBy: { createdAt: 'desc' } }) : [] });
  } finally { await db.$disconnect(); }
});

rewards.put('/redemptions/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '資料無效' }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const actorId = c.get('user').userId;
    const mine = await membership(db, actorId);
    const row = await db.rewardRedemption.findUnique({ where: { id: c.req.param('id') }, include: { reward: true } });
    if (!mine || !row || row.reward.familyId !== mine.familyId) return c.json({ error: '無權審核' }, 403);
    try {
      await db.$transaction(async (tx: any) => {
        const claimed = await tx.rewardRedemption.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: parsed.data.status, reviewedAt: new Date(), reviewedBy: actorId } });
        if (!claimed.count) throw new Error('ALREADY_REVIEWED');
        if (parsed.data.status === 'APPROVED') {
          if (row.reward.maxRedemptions && await tx.rewardRedemption.count({ where: { rewardId: row.rewardId, status: 'APPROVED' } }) > row.reward.maxRedemptions) throw new Error('LIMIT');
          const cost = row.costSnapshot ?? row.reservedPoints ?? row.reward.cost;
          const paid = await tx.user.updateMany({ where: { id: row.userId, points: { gte: cost } }, data: { points: { decrement: cost } } });
          if (!paid.count) throw new Error('INSUFFICIENT_POINTS');
          const user = await tx.user.findUnique({ where: { id: row.userId }, select: { points: true } });
          await tx.pointTransaction.create({ data: { userId: row.userId, amount: -cost, type: 'SPEND', reason: `兌換獎勵：${row.reward.title}`, createdBy: actorId, balanceBefore: (user?.points ?? 0) + cost, balanceAfter: user?.points ?? 0 } });
          if (!row.reward.keepAfterRedemption) await tx.reward.update({ where: { id: row.rewardId }, data: { isActive: false } });
        }
      });
      if (parsed.data.status === 'APPROVED') await evaluateTrophies(db, row.userId);
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === 'ALREADY_REVIEWED') return c.json({ error: '申請已被處理' }, 409);
      if (error instanceof Error && error.message === 'INSUFFICIENT_POINTS') return c.json({ error: '孩子星星不足' }, 400);
      if (error instanceof Error && error.message === 'LIMIT') return c.json({ error: '此獎勵已達兌換次數上限' }, 400);
      throw error;
    }
  } finally { await db.$disconnect(); }
});

rewards.put('/order', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = z.object({ ids: z.array(z.string()).min(1) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '無效排序' }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    if (!mine || await db.reward.count({ where: { familyId: mine.familyId, id: { in: parsed.data.ids } } }) !== parsed.data.ids.length) return c.json({ error: '無權排序' }, 403);
    await db.$transaction(parsed.data.ids.map((id, sortOrder) => db.reward.update({ where: { id }, data: { sortOrder } })));
    return c.json({ success: true });
  } finally { await db.$disconnect(); }
});

rewards.put('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = updateInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    const reward = await db.reward.findFirst({ where: { id: c.req.param('id'), familyId: mine?.familyId } });
    if (!reward) return c.json({ error: '無權編輯' }, 403);
    const { availableDates, ...data } = parsed.data;
    const updated = await db.$transaction(async (tx: any) => {
      if (availableDates) {
        await tx.rewardAvailabilityDate.deleteMany({ where: { rewardId: reward.id } });
        if (availableDates.length) await tx.rewardAvailabilityDate.createMany({ data: [...new Set(availableDates)].map((item) => ({ rewardId: reward.id, date: item })) });
      }
      return tx.reward.update({ where: { id: reward.id }, data: dateValues(data), include: { availableDates: true } });
    });
    return c.json({ reward: updated });
  } finally { await db.$disconnect(); }
});

rewards.delete('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    const reward = await db.reward.findFirst({ where: { id: c.req.param('id'), familyId: mine?.familyId } });
    if (!reward) return c.json({ error: '無權刪除' }, 403);
    if (await db.rewardRedemption.count({ where: { rewardId: reward.id } })) { await db.reward.update({ where: { id: reward.id }, data: { isActive: false } }); return c.json({ success: true, archived: true }); }
    await db.reward.delete({ where: { id: reward.id } });
    return c.json({ success: true, archived: false });
  } finally { await db.$disconnect(); }
});

export default rewards;

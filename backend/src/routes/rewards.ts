import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { effectiveRewardCost, pointBalance, rewardAvailability } from '../lib/reward-rules';
import { evaluateTrophies } from '../lib/trophies';
import { authenticate, requireRoles, type AuthRequest } from '../middleware/auth';

const router = Router();
const time = /^([01]\d|2[0-3]):[0-5]\d$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const inputBase = z.object({ title: z.string().trim().min(1), description: z.string().nullable().optional(), cost: z.number().int().positive(), keepAfterRedemption: z.boolean().optional(), maxRedemptions: z.number().int().positive().nullable().optional(), discountPercent: z.number().int().min(1).max(99).nullable().optional(), discountStart: z.string().datetime().nullable().optional(), discountEnd: z.string().datetime().nullable().optional(), availabilityMode: z.enum(['ALWAYS', 'WEEKENDS', 'DATES', 'WEEKENDS_OR_DATES']).optional(), availableStartTime: z.string().regex(time).nullable().optional(), availableEndTime: z.string().regex(time).nullable().optional(), availableDates: z.array(z.string().regex(date)).max(100).optional() });
const validTimes = (value: { availableStartTime?: string | null; availableEndTime?: string | null }) => !value.availableStartTime || !value.availableEndTime || value.availableStartTime <= value.availableEndTime;
const input = inputBase.refine(validTimes, { message: '結束時間必須晚於開始時間' });
const updateInput = inputBase.partial().refine(validTimes, { message: '結束時間必須晚於開始時間' });
const dates = (value: any) => ({ ...value, discountStart: value.discountStart ? new Date(value.discountStart) : value.discountStart, discountEnd: value.discountEnd ? new Date(value.discountEnd) : value.discountEnd });
async function membership(userId: string) { return prisma.familyMember.findFirst({ where: { userId }, include: { family: true } }); }

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  if (!mine) return void res.json({ rewards: [] });
  const now = new Date();
  const rows = await prisma.reward.findMany({ where: { familyId: mine.familyId, isActive: true }, include: { availableDates: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  res.json({ rewards: rows.map((reward) => ({ ...reward, effectiveCost: effectiveRewardCost(reward, now), availability: rewardAvailability(reward, mine.family.timezone, now) })) });
});

router.post('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = input.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.errors[0].message });
  const mine = await membership(req.user!.userId);
  if (!mine) return void res.status(400).json({ error: '請先加入家庭' });
  const { availableDates = [], ...data } = parsed.data;
  const max = await prisma.reward.aggregate({ where: { familyId: mine.familyId }, _max: { sortOrder: true } });
  const reward = await prisma.reward.create({ data: { ...dates(data), familyId: mine.familyId, createdById: req.user!.userId, keepAfterRedemption: data.keepAfterRedemption ?? true, availabilityMode: data.availabilityMode ?? 'ALWAYS', sortOrder: (max._max.sortOrder ?? -1) + 1, availableDates: { create: [...new Set(availableDates)].map((item) => ({ date: item })) } }, include: { availableDates: true } });
  res.status(201).json({ reward });
});

router.put('/discount/all', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ percent: z.number().int().min(1).max(99).nullable(), start: z.string().datetime().nullable(), end: z.string().datetime().nullable() }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '折扣資料無效' });
  const mine = await membership(req.user!.userId);
  if (!mine) return void res.status(400).json({ error: '請先加入家庭' });
  await prisma.reward.updateMany({ where: { familyId: mine.familyId, isActive: true }, data: { discountPercent: parsed.data.percent, discountStart: parsed.data.start ? new Date(parsed.data.start) : null, discountEnd: parsed.data.end ? new Date(parsed.data.end) : null } });
  res.json({ success: true });
});

router.get('/wishes', authenticate, async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  const parent = ['PARENT', 'ADMIN'].includes(req.user!.role);
  res.json({ wishes: mine ? await prisma.wish.findMany({ where: { familyId: mine.familyId, ...(parent ? {} : { userId: req.user!.userId }) }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }) : [] });
});

router.post('/wishes', authenticate, async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ title: z.string().trim().min(1).max(100), description: z.string().max(300).optional() }).safeParse(req.body);
  const mine = await membership(req.user!.userId);
  if (!parsed.success || !mine) return void res.status(400).json({ error: '願望資料無效' });
  res.status(201).json({ wish: await prisma.wish.create({ data: { ...parsed.data, familyId: mine.familyId, userId: req.user!.userId } }) });
});

router.get('/redemptions/mine', authenticate, async (req: AuthRequest, res: Response) => {
  res.json({ redemptions: await prisma.rewardRedemption.findMany({ where: { userId: req.user!.userId }, include: { reward: true }, orderBy: { createdAt: 'desc' }, take: 100 }) });
});

router.put('/wishes/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ status: z.enum(['APPROVED', 'REJECTED']), cost: z.number().int().positive().optional() }).safeParse(req.body);
  const mine = await membership(req.user!.userId);
  if (!parsed.success || !mine) return void res.status(400).json({ error: '資料無效' });
  const wish = await prisma.wish.findFirst({ where: { id: req.params.id, familyId: mine.familyId, status: 'PENDING' } });
  if (!wish) return void res.status(404).json({ error: '找不到待處理願望' });
  if (parsed.data.status === 'APPROVED') {
    if (!parsed.data.cost) return void res.status(400).json({ error: '請填寫所需星星數' });
    const max = await prisma.reward.aggregate({ where: { familyId: mine.familyId }, _max: { sortOrder: true } });
    await prisma.reward.create({ data: { familyId: mine.familyId, createdById: req.user!.userId, title: wish.title, description: wish.description, cost: parsed.data.cost, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
  }
  const updated = await prisma.wish.update({ where: { id: wish.id }, data: { status: parsed.data.status, reviewedAt: new Date(), reviewedBy: req.user!.userId } });
  if (parsed.data.status === 'APPROVED') await evaluateTrophies(prisma, wish.userId);
  res.json({ wish: updated });
});

router.get('/pending', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  res.json({ redemptions: mine ? await prisma.rewardRedemption.findMany({ where: { status: 'PENDING', reward: { familyId: mine.familyId } }, include: { reward: true, user: { select: { id: true, name: true, points: true } } }, orderBy: { createdAt: 'desc' } }) : [] });
});

router.post('/redemptions/:id/cancel', authenticate, requireRoles('CHILD'), async (req: AuthRequest, res: Response) => {
  const changed = await prisma.rewardRedemption.updateMany({ where: { id: req.params.id, userId: req.user!.userId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  if (!changed.count) return void res.status(404).json({ error: '找不到可撤回的申請' });
  res.json({ success: true });
});

router.put('/redemptions/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '資料無效' });
  const actorId = req.user!.userId;
  const mine = await membership(actorId);
  const row = await prisma.rewardRedemption.findUnique({ where: { id: req.params.id }, include: { reward: true } });
  if (!mine || !row || row.reward.familyId !== mine.familyId) return void res.status(403).json({ error: '無權審核' });
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.rewardRedemption.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: parsed.data.status, reviewedAt: new Date(), reviewedBy: actorId } });
      if (!claimed.count) throw new Error('REVIEWED');
      if (parsed.data.status === 'APPROVED') {
        if (row.reward.maxRedemptions && await tx.rewardRedemption.count({ where: { rewardId: row.rewardId, status: 'APPROVED' } }) > row.reward.maxRedemptions) throw new Error('LIMIT');
        const cost = row.costSnapshot ?? row.reservedPoints ?? row.reward.cost;
        const paid = await tx.user.updateMany({ where: { id: row.userId, points: { gte: cost } }, data: { points: { decrement: cost } } });
        if (!paid.count) throw new Error('INSUFFICIENT');
        const user = await tx.user.findUnique({ where: { id: row.userId }, select: { points: true } });
        await tx.pointTransaction.create({ data: { userId: row.userId, amount: -cost, type: 'SPEND', reason: `兌換獎勵：${row.reward.title}`, createdBy: actorId, balanceBefore: (user?.points ?? 0) + cost, balanceAfter: user?.points ?? 0 } });
        if (!row.reward.keepAfterRedemption) await tx.reward.update({ where: { id: row.rewardId }, data: { isActive: false } });
      }
    });
    if (parsed.data.status === 'APPROVED') await evaluateTrophies(prisma, row.userId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'REVIEWED') return void res.status(409).json({ error: '申請已被處理' });
    if (error instanceof Error && error.message === 'INSUFFICIENT') return void res.status(400).json({ error: '孩子星星不足' });
    if (error instanceof Error && error.message === 'LIMIT') return void res.status(400).json({ error: '此獎勵已達兌換次數上限' });
    throw error;
  }
});

router.put('/order', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body);
  const mine = await membership(req.user!.userId);
  if (!parsed.success || !mine || await prisma.reward.count({ where: { familyId: mine.familyId, id: { in: parsed.data?.ids ?? [] } } }) !== parsed.data?.ids.length) return void res.status(403).json({ error: '無權排序' });
  await prisma.$transaction(parsed.data.ids.map((id, sortOrder) => prisma.reward.update({ where: { id }, data: { sortOrder } })));
  res.json({ success: true });
});

router.post('/:id/redeem', authenticate, requireRoles('CHILD'), async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  const reward = await prisma.reward.findUnique({ where: { id: req.params.id }, include: { availableDates: true } });
  if (!mine || !reward || !reward.isActive) return void res.status(404).json({ error: '獎勵不存在' });
  if (mine.familyId !== reward.familyId) return void res.status(403).json({ error: '無權兌換' });
  const availability = rewardAvailability(reward, mine.family.timezone);
  if (!availability.available) return void res.status(400).json({ error: availability.reason ?? '目前不可兌換' });
  if (reward.maxRedemptions && await prisma.rewardRedemption.count({ where: { rewardId: reward.id, status: 'APPROVED' } }) >= reward.maxRedemptions) return void res.status(400).json({ error: '此獎勵已達兌換次數上限' });
  if (await prisma.rewardRedemption.findFirst({ where: { rewardId: reward.id, userId: req.user!.userId, status: 'PENDING' } })) return void res.status(409).json({ error: '已有待審核的兌換申請' });
  const cost = effectiveRewardCost(reward);
  const balance = await pointBalance(prisma, req.user!.userId);
  if (balance.availablePoints < cost) return void res.status(400).json({ error: '可用星星不足' });
  res.status(201).json({ redemption: await prisma.rewardRedemption.create({ data: { rewardId: reward.id, userId: req.user!.userId, reservedPoints: cost, costSnapshot: cost, availabilitySnapshot: JSON.stringify(availability) } }) });
});

router.put('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = updateInput.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.errors[0].message });
  const mine = await membership(req.user!.userId);
  const reward = await prisma.reward.findFirst({ where: { id: req.params.id, familyId: mine?.familyId } });
  if (!reward) return void res.status(403).json({ error: '無權編輯' });
  const { availableDates, ...data } = parsed.data;
  const updated = await prisma.$transaction(async (tx) => {
    if (availableDates) {
      await tx.rewardAvailabilityDate.deleteMany({ where: { rewardId: reward.id } });
      if (availableDates.length) await tx.rewardAvailabilityDate.createMany({ data: [...new Set(availableDates)].map((item) => ({ rewardId: reward.id, date: item })) });
    }
    return tx.reward.update({ where: { id: reward.id }, data: dates(data), include: { availableDates: true } });
  });
  res.json({ reward: updated });
});

router.delete('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  const reward = await prisma.reward.findFirst({ where: { id: req.params.id, familyId: mine?.familyId } });
  if (!reward) return void res.status(403).json({ error: '無權刪除' });
  if (await prisma.rewardRedemption.count({ where: { rewardId: reward.id } })) { await prisma.reward.update({ where: { id: reward.id }, data: { isActive: false } }); return void res.json({ success: true, archived: true }); }
  await prisma.reward.delete({ where: { id: reward.id } });
  res.json({ success: true, archived: false });
});

export default router;

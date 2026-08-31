import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { localParts, monthBounds } from '../lib/family-time';
import { pointBalance } from '../lib/reward-rules';
import { evaluateTrophies } from '../lib/trophies';
import { authenticate, requireRoles, type AuthRequest } from '../middleware/auth';

const router = Router();
async function membership(userId: string) { return prisma.familyMember.findFirst({ where: { userId }, include: { family: true } }); }

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  if (!mine) return void res.json({ requests: [], settings: null });
  const parent = ['PARENT', 'ADMIN'].includes(req.user!.role);
  const requests = await prisma.allowanceRedemption.findMany({ where: { familyId: mine.familyId, ...(parent ? {} : { userId: req.user!.userId }) }, include: { user: { select: { id: true, name: true, points: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ requests, settings: { pointsPerTwd: mine.family.pointsPerTwd, monthlyAllowanceLimitTwd: mine.monthlyAllowanceLimitTwd, timezone: mine.family.timezone } });
});

router.post('/', authenticate, requireRoles('CHILD'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ amountTwd: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '金額必須為正整數' });
  const userId = req.user!.userId;
  const mine = await membership(userId);
  if (!mine?.family.pointsPerTwd) return void res.status(400).json({ error: '家庭尚未設定零用錢兌換比例' });
  const local = localParts(new Date(), mine.family.timezone);
  const bounds = monthBounds(`${local.year}-${String(local.month).padStart(2, '0')}`, mine.family.timezone);
  const used = await prisma.allowanceRedemption.aggregate({ where: { userId, createdAt: { gte: bounds.start, lt: bounds.end }, status: { in: ['PENDING', 'APPROVED'] } }, _sum: { amountTwd: true } });
  if (mine.monthlyAllowanceLimitTwd && (used._sum.amountTwd ?? 0) + parsed.data.amountTwd > mine.monthlyAllowanceLimitTwd) return void res.status(400).json({ error: `本月零用錢上限為 NT$${mine.monthlyAllowanceLimitTwd}` });
  const reservedPoints = parsed.data.amountTwd * mine.family.pointsPerTwd;
  if ((await pointBalance(prisma, userId)).availablePoints < reservedPoints) return void res.status(400).json({ error: '可用星星不足' });
  res.status(201).json({ request: await prisma.allowanceRedemption.create({ data: { familyId: mine.familyId, userId, amountTwd: parsed.data.amountTwd, pointsPerTwdSnapshot: mine.family.pointsPerTwd, reservedPoints } }) });
});

router.get('/pending', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  res.json({ requests: mine ? await prisma.allowanceRedemption.findMany({ where: { familyId: mine.familyId, status: 'PENDING' }, include: { user: { select: { id: true, name: true, points: true } } }, orderBy: { createdAt: 'desc' } }) : [] });
});

router.post('/:id/cancel', authenticate, requireRoles('CHILD'), async (req: AuthRequest, res: Response) => {
  const changed = await prisma.allowanceRedemption.updateMany({ where: { id: req.params.id, userId: req.user!.userId, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  if (!changed.count) return void res.status(404).json({ error: '找不到可撤回的申請' });
  res.json({ success: true });
});

router.put('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ status: z.enum(['APPROVED', 'REJECTED']) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '資料無效' });
  const actorId = req.user!.userId;
  const mine = await membership(actorId);
  const request = await prisma.allowanceRedemption.findUnique({ where: { id: req.params.id } });
  if (!mine || !request || request.familyId !== mine.familyId) return void res.status(403).json({ error: '無權審核' });
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.allowanceRedemption.updateMany({ where: { id: request.id, status: 'PENDING' }, data: { status: parsed.data.status, reviewedAt: new Date(), reviewedBy: actorId } });
      if (!claimed.count) throw new Error('REVIEWED');
      if (parsed.data.status === 'APPROVED') {
        const paid = await tx.user.updateMany({ where: { id: request.userId, points: { gte: request.reservedPoints } }, data: { points: { decrement: request.reservedPoints } } });
        if (!paid.count) throw new Error('INSUFFICIENT');
        const user = await tx.user.findUnique({ where: { id: request.userId }, select: { points: true } });
        await tx.pointTransaction.create({ data: { userId: request.userId, amount: -request.reservedPoints, type: 'SPEND', reason: `兌換零用錢：NT$${request.amountTwd}`, createdBy: actorId, balanceBefore: (user?.points ?? 0) + request.reservedPoints, balanceAfter: user?.points ?? 0 } });
      }
    });
    if (parsed.data.status === 'APPROVED') await evaluateTrophies(prisma, request.userId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'REVIEWED') return void res.status(409).json({ error: '申請已被處理' });
    if (error instanceof Error && error.message === 'INSUFFICIENT') return void res.status(400).json({ error: '孩子星星不足' });
    throw error;
  }
});

export default router;

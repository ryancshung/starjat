import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { pointBalance, reservedPoints } from '../lib/reward-rules';
import { evaluateTrophies } from '../lib/trophies';
import { authenticate, requireRoles, type AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/award', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ userId: z.string().min(1), amount: z.number().int().positive(), reason: z.string().trim().min(1) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '請填寫有效數量與原因' });
  const mine = await prisma.familyMember.findFirst({ where: { userId: req.user!.userId } });
  if (!mine || !await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: parsed.data.userId } })) return void res.status(403).json({ error: '目標使用者不在您的家庭中' });
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: parsed.data.userId }, select: { points: true } });
    const user = await tx.user.update({ where: { id: parsed.data.userId }, data: { points: { increment: parsed.data.amount } } });
    const transaction = await tx.pointTransaction.create({ data: { userId: parsed.data.userId, amount: parsed.data.amount, type: 'EARN', reason: parsed.data.reason, createdBy: req.user!.userId, balanceBefore: before?.points ?? 0, balanceAfter: user.points } });
    return { user, transaction };
  });
  await evaluateTrophies(prisma, parsed.data.userId);
  res.status(201).json({ points: result.user.points, transaction: result.transaction });
});

router.post('/deduct', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ userId: z.string().min(1), amount: z.number().int().positive(), reason: z.string().trim().min(1) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '請填寫有效數量與孩子能理解的原因' });
  const actorId = req.user!.userId;
  const mine = await prisma.familyMember.findFirst({ where: { userId: actorId }, include: { family: true } });
  if (!mine || (mine.family.ownerId !== actorId && !mine.canDeductPoints)) return void res.status(403).json({ error: '家庭管理者尚未開啟您的扣星權限' });
  const target = await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: parsed.data.userId }, include: { user: true } });
  if (!target || target.user.role !== 'CHILD') return void res.status(403).json({ error: '只能扣除同家庭孩子的星星' });
  const reserved = await reservedPoints(prisma, parsed.data.userId);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({ where: { id: parsed.data.userId, points: { gte: parsed.data.amount + reserved } }, data: { points: { decrement: parsed.data.amount } } });
      if (!changed.count) throw new Error('INSUFFICIENT_POINTS');
      const user = await tx.user.findUnique({ where: { id: parsed.data.userId }, select: { points: true } });
      const after = user?.points ?? 0;
      const transaction = await tx.pointTransaction.create({ data: { userId: parsed.data.userId, amount: -parsed.data.amount, type: 'DEDUCT', reason: parsed.data.reason, createdBy: actorId, balanceBefore: after + parsed.data.amount, balanceAfter: after } });
      return { points: after, transaction };
    });
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_POINTS') return void res.status(400).json({ error: '可用星星不足；待審兌換保留的星星不能扣除' });
    throw error;
  }
});

router.post('/transactions/:id/reverse', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ reason: z.string().trim().min(1) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '請填寫更正原因' });
  const actorId = req.user!.userId;
  const mine = await prisma.familyMember.findFirst({ where: { userId: actorId }, include: { family: true } });
  if (!mine || mine.family.ownerId !== actorId) return void res.status(403).json({ error: '只有家庭管理者可以更正扣星' });
  const original = await prisma.pointTransaction.findUnique({ where: { id: req.params.id } });
  if (!original || original.type !== 'DEDUCT' || !await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: original.userId } })) return void res.status(404).json({ error: '找不到可更正的扣星紀錄' });
  if (await prisma.pointTransaction.findFirst({ where: { reversalOfId: original.id } })) return void res.status(409).json({ error: '這筆扣星已經更正' });
  const amount = Math.abs(original.amount);
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: original.userId }, select: { points: true } });
    const user = await tx.user.update({ where: { id: original.userId }, data: { points: { increment: amount } } });
    const transaction = await tx.pointTransaction.create({ data: { userId: original.userId, amount, type: 'REVERSAL', reason: parsed.data.reason, createdBy: actorId, balanceBefore: before?.points ?? 0, balanceAfter: user.points, reversalOfId: original.id } });
    return { points: user.points, transaction };
  });
  res.status(201).json(result);
});

router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  const targetUserId = String(req.query.userId ?? req.user!.userId);
  if (req.user!.role === 'CHILD' && targetUserId !== req.user!.userId) return void res.status(403).json({ error: '只能查看自己的星星紀錄' });
  if (targetUserId !== req.user!.userId) {
    const mine = await prisma.familyMember.findFirst({ where: { userId: req.user!.userId } });
    if (!mine || !await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: targetUserId } })) return void res.status(403).json({ error: '無權查看此使用者' });
  }
  res.json({ transactions: await prisma.pointTransaction.findMany({ where: { userId: targetUserId }, orderBy: { createdAt: 'desc' }, take: 200 }) });
});

router.get('/balance', authenticate, async (req: AuthRequest, res: Response) => res.json(await pointBalance(prisma, req.user!.userId)));

export default router;

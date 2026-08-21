import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import {
  authenticate,
  requireRoles,
  AuthRequest,
} from '../middleware/auth';

const router = Router();

// POST /api/points/award - 家長發放積分
router.post(
  '/award',
  authenticate,
  requireRoles('PARENT', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        userId: z.string().min(1),
        amount: z.number().int().positive('積分必須為正整數'),
        reason: z.string().min(1, '請填寫原因'),
      });
      const { userId, amount, reason } = schema.parse(req.body);

      // 確認目標使用者與發放者在同一家庭
      const myMembership = await prisma.familyMember.findFirst({
        where: { userId: req.user!.userId },
      });
      if (!myMembership) {
        res.status(403).json({ error: '您尚未加入家庭' });
        return;
      }

      const targetMembership = await prisma.familyMember.findFirst({
        where: { userId, familyId: myMembership.familyId },
      });
      if (!targetMembership) {
        res.status(403).json({ error: '目標使用者不在您的家庭中' });
        return;
      }

      const [user, transaction] = await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { points: { increment: amount } },
        }),
        prisma.pointTransaction.create({
          data: {
            userId,
            amount,
            type: 'EARN',
            reason,
            createdBy: req.user!.userId,
          },
        }),
      ]);

      res.status(201).json({
        points: user.points,
        transaction,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors[0].message });
        return;
      }
      console.error(err);
      res.status(500).json({ error: '發放積分失敗' });
    }
  }
);

// GET /api/points/history - 積分歷史
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId =
      (req.query.userId as string) || req.user!.userId;

    // 孩子只能看自己的
    if (
      req.user!.role === 'CHILD' &&
      targetUserId !== req.user!.userId
    ) {
      res.status(403).json({ error: '只能查看自己的積分歷史' });
      return;
    }

    // 家長只能看同家庭成員
    if (req.user!.role === 'PARENT' || req.user!.role === 'ADMIN') {
      if (targetUserId !== req.user!.userId) {
        const myMembership = await prisma.familyMember.findFirst({
          where: { userId: req.user!.userId },
        });
        const targetMembership = await prisma.familyMember.findFirst({
          where: {
            userId: targetUserId,
            familyId: myMembership?.familyId,
          },
        });
        if (!targetMembership) {
          res.status(403).json({ error: '無權查看此使用者' });
          return;
        }
      }
    }

    const transactions = await prisma.pointTransaction.findMany({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ transactions });
  } catch {
    res.status(500).json({ error: '取得歷史失敗' });
  }
});

// GET /api/points/balance - 目前積分
router.get('/balance', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { points: true },
    });
    res.json({ points: user?.points ?? 0 });
  } catch {
    res.status(500).json({ error: '取得積分失敗' });
  }
});

export default router;

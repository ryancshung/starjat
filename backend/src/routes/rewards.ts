import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import {
  authenticate,
  requireRoles,
  AuthRequest,
} from '../middleware/auth';

const router = Router();

async function getFamilyId(userId: string): Promise<string | null> {
  const m = await prisma.familyMember.findFirst({ where: { userId } });
  return m?.familyId ?? null;
}

// GET /api/rewards
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const familyId = await getFamilyId(req.user!.userId);
    if (!familyId) {
      res.json({ rewards: [] });
      return;
    }

    const rewards = await prisma.reward.findMany({
      where: { familyId, isActive: true },
      orderBy: { cost: 'asc' },
    });

    res.json({ rewards });
  } catch {
    res.status(500).json({ error: '取得獎勵失敗' });
  }
});

// POST /api/rewards
router.post(
  '/',
  authenticate,
  requireRoles('PARENT', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        cost: z.number().int().positive(),
      });
      const data = schema.parse(req.body);

      const familyId = await getFamilyId(req.user!.userId);
      if (!familyId) {
        res.status(400).json({ error: '請先建立或加入家庭' });
        return;
      }

      const reward = await prisma.reward.create({
        data: {
          familyId,
          createdById: req.user!.userId,
          title: data.title,
          description: data.description,
          cost: data.cost,
        },
      });

      res.status(201).json({ reward });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors[0].message });
        return;
      }
      res.status(500).json({ error: '建立獎勵失敗' });
    }
  }
);

// POST /api/rewards/:id/redeem - 孩子兌換
router.post(
  '/:id/redeem',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const reward = await prisma.reward.findUnique({
        where: { id: req.params.id },
      });
      if (!reward || !reward.isActive) {
        res.status(404).json({ error: '獎勵不存在' });
        return;
      }

      const familyId = await getFamilyId(req.user!.userId);
      if (familyId !== reward.familyId) {
        res.status(403).json({ error: '無權兌換此獎勵' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user!.userId },
      });
      if (!user || user.points < reward.cost) {
        res.status(400).json({ error: '積分不足' });
        return;
      }

      const pending = await prisma.rewardRedemption.findFirst({
        where: {
          rewardId: reward.id,
          userId: req.user!.userId,
          status: 'PENDING',
        },
      });
      if (pending) {
        res.status(400).json({ error: '已有待審核的兌換申請' });
        return;
      }

      const redemption = await prisma.rewardRedemption.create({
        data: {
          rewardId: reward.id,
          userId: req.user!.userId,
        },
      });

      res.status(201).json({ redemption });
    } catch {
      res.status(500).json({ error: '兌換失敗' });
    }
  }
);

// PUT /api/rewards/redemptions/:id - 家長審核兌換
router.put(
  '/redemptions/:id',
  authenticate,
  requireRoles('PARENT', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        status: z.enum(['APPROVED', 'REJECTED']),
      });
      const { status } = schema.parse(req.body);

      const redemption = await prisma.rewardRedemption.findUnique({
        where: { id: req.params.id },
        include: { reward: true },
      });
      if (!redemption || redemption.status !== 'PENDING') {
        res.status(404).json({ error: '找不到待審核的兌換' });
        return;
      }

      const familyId = await getFamilyId(req.user!.userId);
      if (familyId !== redemption.reward.familyId) {
        res.status(403).json({ error: '無權審核' });
        return;
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (status === 'APPROVED') {
          const user = await tx.user.findUnique({
            where: { id: redemption.userId },
          });
          if (!user || user.points < redemption.reward.cost) {
            throw new Error('INTEGRAL_INSUFFICIENT');
          }

          await tx.user.update({
            where: { id: redemption.userId },
            data: { points: { decrement: redemption.reward.cost } },
          });
          await tx.pointTransaction.create({
            data: {
              userId: redemption.userId,
              amount: -redemption.reward.cost,
              type: 'SPEND',
              reason: `兌換獎勵：${redemption.reward.title}`,
              createdBy: req.user!.userId,
            },
          });
        }

        return tx.rewardRedemption.update({
          where: { id: redemption.id },
          data: {
            status,
            reviewedAt: new Date(),
            reviewedBy: req.user!.userId,
          },
        });
      });

      res.json({ redemption: updated });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors[0].message });
        return;
      }
      if (err instanceof Error && err.message === 'INTEGRAL_INSUFFICIENT') {
        res.status(400).json({ error: '孩子積分不足，無法核准' });
        return;
      }
      console.error(err);
      res.status(500).json({ error: '審核失敗' });
    }
  }
);

// GET /api/rewards/pending
router.get(
  '/pending',
  authenticate,
  requireRoles('PARENT', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const familyId = await getFamilyId(req.user!.userId);
      if (!familyId) {
        res.json({ redemptions: [] });
        return;
      }

      const redemptions = await prisma.rewardRedemption.findMany({
        where: {
          status: 'PENDING',
          reward: { familyId },
        },
        include: {
          reward: true,
          user: { select: { id: true, name: true, points: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ redemptions });
    } catch {
      res.status(500).json({ error: '取得待審核兌換失敗' });
    }
  }
);

export default router;

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { generateInviteCode } from '../lib/auth';
import {
  authenticate,
  requireRoles,
  AuthRequest,
} from '../middleware/auth';

const router = Router();

// POST /api/families - 建立家庭
router.post(
  '/',
  authenticate,
  requireRoles('PARENT', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({ name: z.string().min(1, '請輸入家庭名稱') });
      const { name } = schema.parse(req.body);

      const existing = await prisma.familyMember.findFirst({
        where: { userId: req.user!.userId },
      });
      if (existing) {
        res.status(400).json({ error: '您已經加入一個家庭' });
        return;
      }

      let inviteCode = generateInviteCode();
      // 確保邀請碼唯一
      while (await prisma.family.findUnique({ where: { inviteCode } })) {
        inviteCode = generateInviteCode();
      }

      const family = await prisma.family.create({
        data: {
          name,
          inviteCode,
          members: {
            create: { userId: req.user!.userId },
          },
        },
        include: {
          members: {
            include: {
              user: {
                select: { id: true, name: true, email: true, role: true, points: true },
              },
            },
          },
        },
      });

      res.status(201).json({ family });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors[0].message });
        return;
      }
      console.error(err);
      res.status(500).json({ error: '建立家庭失敗' });
    }
  }
);

// POST /api/families/join - 用邀請碼加入
router.post('/join', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const schema = z.object({
      inviteCode: z.string().min(4, '請輸入邀請碼'),
    });
    const { inviteCode } = schema.parse(req.body);

    const existing = await prisma.familyMember.findFirst({
      where: { userId: req.user!.userId },
    });
    if (existing) {
      res.status(400).json({ error: '您已經加入一個家庭' });
      return;
    }

    const family = await prisma.family.findUnique({
      where: { inviteCode: inviteCode.toUpperCase() },
    });
    if (!family) {
      res.status(404).json({ error: '無效的邀請碼' });
      return;
    }

    await prisma.familyMember.create({
      data: { familyId: family.id, userId: req.user!.userId },
    });

    const updated = await prisma.family.findUnique({
      where: { id: family.id },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true, points: true },
            },
          },
        },
      },
    });

    res.json({ family: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    res.status(500).json({ error: '加入家庭失敗' });
  }
});

// GET /api/families/me - 我的家庭
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const membership = await prisma.familyMember.findFirst({
      where: { userId: req.user!.userId },
      include: {
        family: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    points: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!membership) {
      res.json({ family: null });
      return;
    }

    res.json({ family: membership.family });
  } catch {
    res.status(500).json({ error: '取得家庭資料失敗' });
  }
});

// DELETE /api/families/members/:userId - 移除成員（家長）
router.delete(
  '/members/:userId',
  authenticate,
  requireRoles('PARENT', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const targetUserId = req.params.userId;
      if (targetUserId === req.user!.userId) {
        res.status(400).json({ error: '不能移除自己' });
        return;
      }

      const myMembership = await prisma.familyMember.findFirst({
        where: { userId: req.user!.userId },
      });
      if (!myMembership) {
        res.status(403).json({ error: '您不在任何家庭中' });
        return;
      }

      const target = await prisma.familyMember.findFirst({
        where: {
          familyId: myMembership.familyId,
          userId: targetUserId,
        },
      });
      if (!target) {
        res.status(404).json({ error: '成員不存在' });
        return;
      }

      await prisma.familyMember.delete({ where: { id: target.id } });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: '移除成員失敗' });
    }
  }
);

export default router;

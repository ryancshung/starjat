import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  authenticate,
  requireRoles,
  AuthRequest,
} from '../middleware/auth';

const router = Router();

// GET /api/admin/users
router.get(
  '/users',
  authenticate,
  requireRoles('ADMIN'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          points: true,
          createdAt: true,
          memberships: {
            include: {
              family: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ users });
    } catch {
      res.status(500).json({ error: '取得使用者列表失敗' });
    }
  }
);

// GET /api/admin/families
router.get(
  '/families',
  authenticate,
  requireRoles('ADMIN'),
  async (_req: AuthRequest, res: Response) => {
    try {
      const families = await prisma.family.findMany({
        include: {
          members: {
            include: {
              user: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
          _count: {
            select: { tasks: true, rewards: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ families });
    } catch {
      res.status(500).json({ error: '取得家庭列表失敗' });
    }
  }
);

// DELETE /api/admin/users/:id
router.delete(
  '/users/:id',
  authenticate,
  requireRoles('ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (req.params.id === req.user!.userId) {
        res.status(400).json({ error: '不能刪除自己' });
        return;
      }
      await prisma.user.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: '刪除使用者失敗' });
    }
  }
);

export default router;

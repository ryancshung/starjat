import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { z } from 'zod';
import { hashPassword } from '../lib/auth';
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

router.put('/users/:id/password', authenticate, requireRoles('ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ password: z.string().min(6, '密碼至少 6 個字元').max(128, '密碼最多 128 個字元') }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.errors[0].message });
  if (req.params.id === req.user!.userId) return void res.status(400).json({ error: '請由其他管理者協助重設密碼' });
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return void res.status(404).json({ error: '使用者不存在' });
  await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await hashPassword(parsed.data.password) } });
  res.json({ success: true });
});

export default router;

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import {
  hashPassword,
  comparePassword,
  signToken,
  generateInviteCode,
  Role,
} from '../lib/auth';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const registerSchema = z.object({
  email: z.string().email('無效的 Email'),
  password: z.string().min(6, '密碼至少 6 個字元'),
  name: z.string().min(1, '請輸入姓名'),
  role: z.enum(['PARENT', 'CHILD']).default('PARENT'),
  inviteCode: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/register
router.post('/register', async (req, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    if (existing) {
      res.status(400).json({ error: '此 Email 已被註冊' });
      return;
    }

    const passwordHash = await hashPassword(body.password);
    let role: Role = body.role === 'CHILD' ? 'CHILD' : 'PARENT';

    // 第一位註冊的使用者自動成為 ADMIN
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      role = 'ADMIN';
    }

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash,
        name: body.name,
        role,
      },
    });

    // 孩子用邀請碼加入家庭
    if (body.role === 'CHILD' && body.inviteCode) {
      const family = await prisma.family.findUnique({
        where: { inviteCode: body.inviteCode.toUpperCase() },
      });
      if (!family) {
        await prisma.user.delete({ where: { id: user.id } });
        res.status(400).json({ error: '無效的邀請碼' });
        return;
      }
      await prisma.familyMember.create({
        data: { familyId: family.id, userId: user.id },
      });
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        points: user.points,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: '註冊失敗' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    if (!user) {
      res.status(401).json({ error: 'Email 或密碼錯誤' });
      return;
    }

    const valid = await comparePassword(body.password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Email 或密碼錯誤' });
      return;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        points: user.points,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors[0].message });
      return;
    }
    res.status(500).json({ error: '登入失敗' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        points: true,
        createdAt: true,
        memberships: {
          include: {
            family: {
              select: { id: true, name: true, inviteCode: true },
            },
          },
        },
      },
    });
    if (!user) {
      res.status(404).json({ error: '使用者不存在' });
      return;
    }
    res.json({ user });
  } catch {
    res.status(500).json({ error: '取得使用者資料失敗' });
  }
});

export default router;

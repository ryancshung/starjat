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

// GET /api/tasks
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const familyId = await getFamilyId(req.user!.userId);
    if (!familyId) {
      res.json({ tasks: [] });
      return;
    }

    const tasks = await prisma.task.findMany({
      where: { familyId, isActive: true },
      include: {
        createdBy: { select: { id: true, name: true } },
        completions: {
          where: { status: 'PENDING' },
          include: { user: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ tasks });
  } catch {
    res.status(500).json({ error: '取得任務失敗' });
  }
});

// POST /api/tasks
router.post(
  '/',
  authenticate,
  requireRoles('PARENT', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        points: z.number().int().positive(),
        isRecurring: z.boolean().optional(),
        recurringType: z.enum(['daily', 'weekly']).optional(),
      });
      const data = schema.parse(req.body);

      const familyId = await getFamilyId(req.user!.userId);
      if (!familyId) {
        res.status(400).json({ error: '請先建立或加入家庭' });
        return;
      }

      const task = await prisma.task.create({
        data: {
          familyId,
          createdById: req.user!.userId,
          title: data.title,
          description: data.description,
          points: data.points,
          isRecurring: data.isRecurring ?? false,
          recurringType: data.recurringType,
        },
      });

      res.status(201).json({ task });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors[0].message });
        return;
      }
      res.status(500).json({ error: '建立任務失敗' });
    }
  }
);

// POST /api/tasks/:id/complete - 孩子標記完成
router.post(
  '/:id/complete',
  authenticate,
  async (req: AuthRequest, res: Response) => {
    try {
      const taskId = req.params.id;
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task || !task.isActive) {
        res.status(404).json({ error: '任務不存在' });
        return;
      }

      const familyId = await getFamilyId(req.user!.userId);
      if (familyId !== task.familyId) {
        res.status(403).json({ error: '無權操作此任務' });
        return;
      }

      // 避免重複待審核
      const pending = await prisma.taskCompletion.findFirst({
        where: {
          taskId,
          userId: req.user!.userId,
          status: 'PENDING',
        },
      });
      if (pending) {
        res.status(400).json({ error: '已有待審核的完成申請' });
        return;
      }

      const completion = await prisma.taskCompletion.create({
        data: {
          taskId,
          userId: req.user!.userId,
          note: req.body.note,
        },
      });

      res.status(201).json({ completion });
    } catch {
      res.status(500).json({ error: '提交完成失敗' });
    }
  }
);

// PUT /api/tasks/completions/:id - 家長審核
router.put(
  '/completions/:id',
  authenticate,
  requireRoles('PARENT', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const schema = z.object({
        status: z.enum(['APPROVED', 'REJECTED']),
      });
      const { status } = schema.parse(req.body);

      const completion = await prisma.taskCompletion.findUnique({
        where: { id: req.params.id },
        include: { task: true },
      });
      if (!completion || completion.status !== 'PENDING') {
        res.status(404).json({ error: '找不到待審核的完成紀錄' });
        return;
      }

      const familyId = await getFamilyId(req.user!.userId);
      if (familyId !== completion.task.familyId) {
        res.status(403).json({ error: '無權審核' });
        return;
      }

      const updated = await prisma.$transaction(async (tx) => {
        const c = await tx.taskCompletion.update({
          where: { id: completion.id },
          data: {
            status,
            reviewedAt: new Date(),
            reviewedBy: req.user!.userId,
          },
        });

        if (status === 'APPROVED') {
          await tx.user.update({
            where: { id: completion.userId },
            data: { points: { increment: completion.task.points } },
          });
          await tx.pointTransaction.create({
            data: {
              userId: completion.userId,
              amount: completion.task.points,
              type: 'EARN',
              reason: `完成任務：${completion.task.title}`,
              createdBy: req.user!.userId,
            },
          });
        }

        return c;
      });

      res.json({ completion: updated });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.errors[0].message });
        return;
      }
      console.error(err);
      res.status(500).json({ error: '審核失敗' });
    }
  }
);

// GET /api/tasks/pending - 待審核列表（家長）
router.get(
  '/pending',
  authenticate,
  requireRoles('PARENT', 'ADMIN'),
  async (req: AuthRequest, res: Response) => {
    try {
      const familyId = await getFamilyId(req.user!.userId);
      if (!familyId) {
        res.json({ completions: [] });
        return;
      }

      const completions = await prisma.taskCompletion.findMany({
        where: {
          status: 'PENDING',
          task: { familyId },
        },
        include: {
          task: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: { completedAt: 'desc' },
      });

      res.json({ completions });
    } catch {
      res.status(500).json({ error: '取得待審核列表失敗' });
    }
  }
);

export default router;

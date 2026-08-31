import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { nextScheduledRun } from '../lib/family-time';
import { authenticate, requireRoles, type AuthRequest } from '../middleware/auth';

const router = Router();
const input = z.object({ userId: z.string().min(1), name: z.string().trim().min(1).max(100), amount: z.number().int().positive(), frequency: z.enum(['daily', 'weekly', 'monthly']), startAt: z.string().datetime().optional(), localTime: z.string().regex(/^([01]\d|2[0-3]):(00|15|30|45)$/), weekday: z.number().int().min(0).max(6).nullable().optional(), dayOfMonth: z.number().int().min(1).max(31).nullable().optional(), isActive: z.boolean().optional() });
async function membership(userId: string) { return prisma.familyMember.findFirst({ where: { userId }, include: { family: true } }); }

router.get('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  if (!mine) return void res.json({ schedules: [] });
  const schedules = await prisma.scheduledAward.findMany({ where: { familyId: mine.familyId }, orderBy: { createdAt: 'desc' } });
  const users = await prisma.user.findMany({ where: { id: { in: schedules.map((item) => item.userId) } }, select: { id: true, name: true } });
  res.json({ schedules: schedules.map((item) => ({ ...item, user: users.find((user) => user.id === item.userId) })) });
});

router.post('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = input.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.errors[0].message });
  const mine = await membership(req.user!.userId);
  if (!mine || !await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: parsed.data.userId } })) return void res.status(400).json({ error: '目標成員不在家庭中' });
  const startAt = parsed.data.startAt ? new Date(parsed.data.startAt) : new Date();
  const rule = { frequency: parsed.data.frequency, localTime: parsed.data.localTime, weekday: parsed.data.weekday ?? null, dayOfMonth: parsed.data.dayOfMonth ?? null };
  const nextRunAt = nextScheduledRun(rule, mine.family.timezone, new Date(Math.max(Date.now(), startAt.getTime() - 1)));
  res.status(201).json({ schedule: await prisma.scheduledAward.create({ data: { ...parsed.data, familyId: mine.familyId, createdById: req.user!.userId, startAt, nextRunAt } }) });
});

router.put('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = input.partial().safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.errors[0].message });
  const mine = await membership(req.user!.userId);
  const schedule = await prisma.scheduledAward.findFirst({ where: { id: req.params.id, familyId: mine?.familyId } });
  if (!mine || !schedule) return void res.status(404).json({ error: '找不到設定' });
  const data = { ...parsed.data, startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : undefined };
  const nextRunAt = nextScheduledRun({ ...schedule, ...data }, mine.family.timezone, new Date());
  res.json({ schedule: await prisma.scheduledAward.update({ where: { id: schedule.id }, data: { ...data, nextRunAt } }) });
});

router.delete('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  const schedule = await prisma.scheduledAward.findFirst({ where: { id: req.params.id, familyId: mine?.familyId } });
  if (!schedule) return void res.status(404).json({ error: '找不到設定' });
  await prisma.scheduledAward.delete({ where: { id: schedule.id } });
  res.json({ success: true });
});

export default router;

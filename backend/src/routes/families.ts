import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { generateInviteCode } from '../lib/auth';
import { isValidTimezone } from '../lib/family-time';
import { authenticate, requireRoles, type AuthRequest } from '../middleware/auth';

const router = Router();
const memberSelect = { id: true, name: true, email: true, role: true, points: true } as const;
const includeFamily = { members: { include: { user: { select: memberSelect } } } } as const;

router.post('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '請輸入家庭名稱' });
  const userId = req.user!.userId;
  if (await prisma.familyMember.findFirst({ where: { userId } })) return void res.status(400).json({ error: '您已經加入一個家庭' });
  let inviteCode = generateInviteCode();
  while (await prisma.family.findUnique({ where: { inviteCode } })) inviteCode = generateInviteCode();
  const family = await prisma.family.create({ data: { name: parsed.data.name, inviteCode, ownerId: userId, timezone: 'Asia/Taipei', members: { create: { userId } } }, include: includeFamily });
  res.status(201).json({ family });
});

router.post('/join', authenticate, async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ inviteCode: z.string().min(4) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '請輸入邀請碼' });
  const userId = req.user!.userId;
  if (await prisma.familyMember.findFirst({ where: { userId } })) return void res.status(400).json({ error: '您已經加入一個家庭' });
  const family = await prisma.family.findUnique({ where: { inviteCode: parsed.data.inviteCode.toUpperCase() } });
  if (!family) return void res.status(404).json({ error: '無效的邀請碼' });
  await prisma.familyMember.create({ data: { familyId: family.id, userId } });
  res.json({ family: await prisma.family.findUnique({ where: { id: family.id }, include: includeFamily }) });
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const membership = await prisma.familyMember.findFirst({ where: { userId: req.user!.userId }, include: { family: { include: includeFamily } } });
  res.json({ family: membership?.family ?? null });
});

router.put('/me', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '請輸入家庭名稱' });
  const mine = await prisma.familyMember.findFirst({ where: { userId: req.user!.userId }, include: { family: true } });
  if (!mine || mine.family.ownerId !== req.user!.userId) return void res.status(403).json({ error: '只有家庭管理者可以修改家庭資料' });
  res.json({ family: await prisma.family.update({ where: { id: mine.familyId }, data: { name: parsed.data.name } }) });
});

router.put('/settings', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ timezone: z.string().optional(), pointsPerTwd: z.number().int().positive().nullable().optional() }).safeParse(req.body);
  if (!parsed.success || (parsed.data.timezone && !isValidTimezone(parsed.data.timezone))) return void res.status(400).json({ error: '家庭設定無效' });
  const mine = await prisma.familyMember.findFirst({ where: { userId: req.user!.userId }, include: { family: true } });
  if (!mine || mine.family.ownerId !== req.user!.userId) return void res.status(403).json({ error: '只有家庭管理者可以修改設定' });
  res.json({ family: await prisma.family.update({ where: { id: mine.familyId }, data: parsed.data }) });
});

router.put('/members/:userId/settings', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ canDeductPoints: z.boolean().optional(), monthlyAllowanceLimitTwd: z.number().int().positive().nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: '成員設定無效' });
  const mine = await prisma.familyMember.findFirst({ where: { userId: req.user!.userId }, include: { family: true } });
  if (!mine || mine.family.ownerId !== req.user!.userId) return void res.status(403).json({ error: '只有家庭管理者可以修改成員權限' });
  const target = await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: req.params.userId } });
  if (!target) return void res.status(404).json({ error: '成員不存在' });
  res.json({ membership: await prisma.familyMember.update({ where: { id: target.id }, data: parsed.data }) });
});

router.delete('/members/:userId', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const mine = await prisma.familyMember.findFirst({ where: { userId: req.user!.userId }, include: { family: true } });
  if (!mine || mine.family.ownerId !== req.user!.userId) return void res.status(403).json({ error: '只有家庭管理者可以管理成員' });
  if (req.params.userId === req.user!.userId) return void res.status(400).json({ error: '不能移除自己' });
  const target = await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: req.params.userId } });
  if (!target) return void res.status(404).json({ error: '成員不存在' });
  await prisma.familyMember.delete({ where: { id: target.id } });
  res.json({ success: true });
});

export default router;

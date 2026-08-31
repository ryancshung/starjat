import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { evaluateTrophies, trophyProgress } from '../lib/trophies';
import { authenticate, requireRoles, type AuthRequest } from '../middleware/auth';

const router = Router();
const input = z.object({ title: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(200), tier: z.enum(['BRONZE', 'SILVER', 'GOLD', 'STELLAR']), iconKey: z.string().trim().min(1).max(30).default('trophy'), isSecret: z.boolean().default(false), triggerType: z.enum(['MANUAL', 'TASK_APPROVED_COUNT', 'POINTS_EARNED', 'REWARD_APPROVED_COUNT', 'WISH_APPROVED_COUNT']), threshold: z.number().int().positive().default(1), isActive: z.boolean().optional() });
async function membership(userId: string) { return prisma.familyMember.findFirst({ where: { userId }, include: { family: true } }); }

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const mine = await membership(req.user!.userId);
  if (!mine) return void res.json({ trophies: [] });
  const targetUserId = String(req.query.userId ?? req.user!.userId);
  if (req.user!.role === 'CHILD' && targetUserId !== req.user!.userId) return void res.status(403).json({ error: '只能查看自己的獎盃' });
  if (!await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: targetUserId } })) return void res.status(403).json({ error: '無權查看此成員' });
  await evaluateTrophies(prisma, targetUserId, 'RETROACTIVE');
  const definitions = await prisma.trophyDefinition.findMany({ where: { isActive: true, OR: [{ scope: 'SYSTEM' }, { familyId: mine.familyId }] }, orderBy: [{ tier: 'asc' }, { createdAt: 'asc' }] });
  const unlocks = await prisma.userTrophy.findMany({ where: { userId: targetUserId, trophyId: { in: definitions.map((item) => item.id) } } });
  const result = [];
  for (const definition of definitions) {
    const unlock = unlocks.find((item) => item.trophyId === definition.id);
    const progress = unlock ? definition.threshold : await trophyProgress(prisma, targetUserId, definition.triggerType);
    result.push({ ...definition, progress: Math.min(progress, definition.threshold), unlocked: Boolean(unlock), unlock });
  }
  res.json({ trophies: result });
});

router.post('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = input.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.errors[0].message });
  const mine = await membership(req.user!.userId);
  if (!mine || mine.family.ownerId !== req.user!.userId) return void res.status(403).json({ error: '只有家庭管理者可以建立獎盃' });
  res.status(201).json({ trophy: await prisma.trophyDefinition.create({ data: { ...parsed.data, scope: 'FAMILY', familyId: mine.familyId, createdById: req.user!.userId } }) });
});

router.put('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = input.partial().safeParse(req.body);
  const mine = await membership(req.user!.userId);
  const definition = await prisma.trophyDefinition.findFirst({ where: { id: req.params.id, familyId: mine?.familyId, scope: 'FAMILY' } });
  if (!parsed.success || !mine || mine.family.ownerId !== req.user!.userId || !definition) return void res.status(403).json({ error: '只有家庭管理者可以修改獎盃' });
  res.json({ trophy: await prisma.trophyDefinition.update({ where: { id: definition.id }, data: parsed.data }) });
});

router.post('/:id/award', authenticate, requireRoles('PARENT', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body);
  const mine = await membership(req.user!.userId);
  if (!parsed.success || !mine) return void res.status(400).json({ error: '請選擇孩子' });
  const definition = await prisma.trophyDefinition.findFirst({ where: { id: req.params.id, isActive: true, OR: [{ scope: 'SYSTEM' }, { familyId: mine.familyId }] } });
  const target = await prisma.familyMember.findFirst({ where: { familyId: mine.familyId, userId: parsed.data.userId }, include: { user: true } });
  if (!definition || !target || target.user.role !== 'CHILD') return void res.status(403).json({ error: '無權頒發' });
  const unlock = await prisma.userTrophy.upsert({ where: { trophyId_userId: { trophyId: definition.id, userId: parsed.data.userId } }, update: {}, create: { trophyId: definition.id, userId: parsed.data.userId, source: 'MANUAL', awardedBy: req.user!.userId } });
  res.status(201).json({ unlock });
});

export default router;

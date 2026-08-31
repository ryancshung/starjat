import { Hono } from 'hono';
import { z } from 'zod';
import { ensureSystemTrophies, evaluateTrophies, trophyProgress } from '../lib/trophies';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, requireRoles, type WorkerRouteEnv } from './shared';

const trophies = new Hono<WorkerRouteEnv>();
const input = z.object({
  title: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(200),
  tier: z.enum(['BRONZE', 'SILVER', 'GOLD', 'STELLAR']), iconKey: z.string().trim().min(1).max(30).default('trophy'),
  isSecret: z.boolean().default(false), triggerType: z.enum(['MANUAL', 'TASK_APPROVED_COUNT', 'POINTS_EARNED', 'REWARD_APPROVED_COUNT', 'WISH_APPROVED_COUNT']),
  threshold: z.number().int().positive().default(1), isActive: z.boolean().optional(),
});

async function membership(db: any, userId: string) { return db.familyMember.findFirst({ where: { userId }, include: { family: true } }); }

trophies.get('/', authenticate, async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const actor = c.get('user');
    const mine = await membership(db, actor.userId);
    if (!mine) return c.json({ trophies: [] });
    const targetUserId = c.req.query('userId') ?? actor.userId;
    if (actor.role === 'CHILD' && targetUserId !== actor.userId) return c.json({ error: '只能查看自己的獎盃' }, 403);
    if (!await db.familyMember.findFirst({ where: { familyId: mine.familyId, userId: targetUserId } })) return c.json({ error: '無權查看此成員' }, 403);
    await evaluateTrophies(db, targetUserId, 'RETROACTIVE');
    const definitions = await db.trophyDefinition.findMany({ where: { isActive: true, OR: [{ scope: 'SYSTEM' }, { familyId: mine.familyId }] }, orderBy: [{ tier: 'asc' }, { createdAt: 'asc' }] });
    const unlocks = await db.userTrophy.findMany({ where: { userId: targetUserId, trophyId: { in: definitions.map((item: any) => item.id) } } });
    const result = [];
    for (const definition of definitions) {
      const unlock = unlocks.find((item: any) => item.trophyId === definition.id);
      const progress = unlock ? definition.threshold : await trophyProgress(db, targetUserId, definition.triggerType);
      result.push({ ...definition, progress: Math.min(progress, definition.threshold), unlocked: Boolean(unlock), unlock });
    }
    return c.json({ trophies: result });
  } finally { await db.$disconnect(); }
});

trophies.post('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = input.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const actorId = c.get('user').userId;
    const mine = await membership(db, actorId);
    if (!mine || mine.family.ownerId !== actorId) return c.json({ error: '只有家庭管理者可以建立獎盃' }, 403);
    return c.json({ trophy: await db.trophyDefinition.create({ data: { ...parsed.data, scope: 'FAMILY', familyId: mine.familyId, createdById: actorId } }) }, 201);
  } finally { await db.$disconnect(); }
});

trophies.put('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = input.partial().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const actorId = c.get('user').userId;
    const mine = await membership(db, actorId);
    const definition = await db.trophyDefinition.findFirst({ where: { id: c.req.param('id'), familyId: mine?.familyId, scope: 'FAMILY' } });
    if (!mine || mine.family.ownerId !== actorId || !definition) return c.json({ error: '只有家庭管理者可以修改獎盃' }, 403);
    return c.json({ trophy: await db.trophyDefinition.update({ where: { id: definition.id }, data: parsed.data }) });
  } finally { await db.$disconnect(); }
});

trophies.post('/:id/award', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: '請選擇孩子' }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const actorId = c.get('user').userId;
    const mine = await membership(db, actorId);
    const definition = await db.trophyDefinition.findFirst({ where: { id: c.req.param('id'), isActive: true, OR: [{ scope: 'SYSTEM' }, { familyId: mine?.familyId }] } });
    const target = await db.familyMember.findFirst({ where: { familyId: mine?.familyId, userId: parsed.data.userId }, include: { user: true } });
    if (!mine || !definition || !target || target.user.role !== 'CHILD') return c.json({ error: '無權頒發' }, 403);
    const unlock = await db.userTrophy.upsert({ where: { trophyId_userId: { trophyId: definition.id, userId: parsed.data.userId } }, update: {}, create: { trophyId: definition.id, userId: parsed.data.userId, source: 'MANUAL', awardedBy: actorId } });
    return c.json({ unlock }, 201);
  } finally { await db.$disconnect(); }
});

export default trophies;

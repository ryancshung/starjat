import { Hono } from 'hono';
import { z } from 'zod';
import { nextScheduledRun } from '../lib/family-time';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, requireRoles, type WorkerRouteEnv } from './shared';

const scheduledAwards = new Hono<WorkerRouteEnv>();
const time = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const input = z.object({
  userId: z.string().min(1), name: z.string().trim().min(1).max(100), amount: z.number().int().positive(),
  frequency: z.enum(['daily', 'weekly', 'monthly']), startAt: z.string().datetime().optional(),
  localTime: z.string().regex(time, '時間必須為 15 分鐘間隔'), weekday: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(), isActive: z.boolean().optional(),
});

async function membership(db: any, userId: string) { return db.familyMember.findFirst({ where: { userId }, include: { family: true } }); }

scheduledAwards.get('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    if (!mine) return c.json({ schedules: [] });
    const schedules = await db.scheduledAward.findMany({ where: { familyId: mine.familyId }, orderBy: { createdAt: 'desc' } });
    const users = await db.user.findMany({ where: { id: { in: schedules.map((item: any) => item.userId) } }, select: { id: true, name: true } });
    return c.json({ schedules: schedules.map((item: any) => ({ ...item, user: users.find((user: any) => user.id === item.userId) })) });
  } finally { await db.$disconnect(); }
});

scheduledAwards.post('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = input.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    if (!mine || !await db.familyMember.findFirst({ where: { familyId: mine.familyId, userId: parsed.data.userId } })) return c.json({ error: '目標成員不在家庭中' }, 400);
    const startAt = parsed.data.startAt ? new Date(parsed.data.startAt) : new Date();
    const rule = { frequency: parsed.data.frequency, localTime: parsed.data.localTime, weekday: parsed.data.weekday ?? null, dayOfMonth: parsed.data.dayOfMonth ?? null };
    const nextRunAt = nextScheduledRun(rule, mine.family.timezone, new Date(Math.max(Date.now(), startAt.getTime() - 1)));
    const schedule = await db.scheduledAward.create({ data: { ...parsed.data, familyId: mine.familyId, createdById: c.get('user').userId, startAt, nextRunAt } });
    return c.json({ schedule }, 201);
  } finally { await db.$disconnect(); }
});

scheduledAwards.put('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const parsed = input.partial().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    const schedule = await db.scheduledAward.findFirst({ where: { id: c.req.param('id'), familyId: mine?.familyId } });
    if (!mine || !schedule) return c.json({ error: '找不到設定' }, 404);
    const data = { ...parsed.data, startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : undefined };
    const merged = { ...schedule, ...data };
    const nextRunAt = nextScheduledRun(merged, mine.family.timezone, new Date());
    return c.json({ schedule: await db.scheduledAward.update({ where: { id: schedule.id }, data: { ...data, nextRunAt } }) });
  } finally { await db.$disconnect(); }
});

scheduledAwards.delete('/:id', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await membership(db, c.get('user').userId);
    const schedule = await db.scheduledAward.findFirst({ where: { id: c.req.param('id'), familyId: mine?.familyId } });
    if (!schedule) return c.json({ error: '找不到設定' }, 404);
    await db.scheduledAward.delete({ where: { id: schedule.id } });
    return c.json({ success: true });
  } finally { await db.$disconnect(); }
});

export default scheduledAwards;

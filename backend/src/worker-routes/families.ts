import { Hono } from 'hono';
import { z } from 'zod';
import { generateInviteCode } from '../lib/auth';
import { isValidTimezone } from '../lib/family-time';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, requireRoles, type WorkerRouteEnv } from './shared';

const families = new Hono<WorkerRouteEnv>();
const memberSelect = { id: true, name: true, email: true, role: true, points: true } as const;
const includeFamily = { members: { include: { user: { select: memberSelect } } } } as const;

families.post('/', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ name: z.string().min(1, '請輸入家庭名稱') }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const userId = c.get('user').userId;
    if (await db.familyMember.findFirst({ where: { userId } })) return c.json({ error: '您已經加入一個家庭' }, 400);
    let inviteCode = generateInviteCode();
    while (await db.family.findUnique({ where: { inviteCode } })) inviteCode = generateInviteCode();
    const family = await db.family.create({ data: { name: body.data.name, inviteCode, ownerId: userId, timezone: 'Asia/Taipei', members: { create: { userId } } }, include: includeFamily });
    return c.json({ family }, 201);
  } catch (error) { console.error(error); return c.json({ error: '建立家庭失敗' }, 500); }
  finally { await db.$disconnect(); }
});

families.post('/join', authenticate, async (c) => {
  const body = z.object({ inviteCode: z.string().min(4, '請輸入邀請碼') }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const userId = c.get('user').userId;
    if (await db.familyMember.findFirst({ where: { userId } })) return c.json({ error: '您已經加入一個家庭' }, 400);
    const family = await db.family.findUnique({ where: { inviteCode: body.data.inviteCode.toUpperCase() } });
    if (!family) return c.json({ error: '無效的邀請碼' }, 404);
    await db.familyMember.create({ data: { familyId: family.id, userId } });
    return c.json({ family: await db.family.findUnique({ where: { id: family.id }, include: includeFamily }) });
  } catch (error) { console.error(error); return c.json({ error: '加入家庭失敗' }, 500); }
  finally { await db.$disconnect(); }
});

families.get('/me', authenticate, async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const membership = await db.familyMember.findFirst({ where: { userId: c.get('user').userId }, include: { family: { include: includeFamily } } });
    return c.json({ family: membership?.family ?? null });
  } catch (error) { console.error(error); return c.json({ error: '取得家庭資料失敗' }, 500); }
  finally { await db.$disconnect(); }
});

families.put('/me', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ name: z.string().min(1, '請輸入家庭名稱').max(100) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: body.error.errors[0].message }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const membership = await db.familyMember.findFirst({ where: { userId: c.get('user').userId }, include: { family: true } });
    if (!membership || membership.family.ownerId !== c.get('user').userId) return c.json({ error: '只有家庭管理者可以修改家庭資料' }, 403);
    return c.json({ family: await db.family.update({ where: { id: membership.familyId }, data: { name: body.data.name } }) });
  } finally { await db.$disconnect(); }
});

families.put('/settings', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ timezone: z.string().optional(), pointsPerTwd: z.number().int().positive().nullable().optional() }).safeParse(await c.req.json());
  if (!body.success || (body.data.timezone && !isValidTimezone(body.data.timezone))) return c.json({ error: '家庭設定無效' }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const membership = await db.familyMember.findFirst({ where: { userId: c.get('user').userId }, include: { family: true } });
    if (!membership || membership.family.ownerId !== c.get('user').userId) return c.json({ error: '只有家庭管理者可以修改設定' }, 403);
    return c.json({ family: await db.family.update({ where: { id: membership.familyId }, data: body.data }) });
  } finally { await db.$disconnect(); }
});

families.put('/members/:userId/settings', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const body = z.object({ canDeductPoints: z.boolean().optional(), monthlyAllowanceLimitTwd: z.number().int().positive().nullable().optional() }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: '成員設定無效' }, 400);
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const mine = await db.familyMember.findFirst({ where: { userId: c.get('user').userId }, include: { family: true } });
    if (!mine || mine.family.ownerId !== c.get('user').userId) return c.json({ error: '只有家庭管理者可以修改成員權限' }, 403);
    const target = await db.familyMember.findFirst({ where: { familyId: mine.familyId, userId: c.req.param('userId') } });
    if (!target) return c.json({ error: '成員不存在' }, 404);
    return c.json({ membership: await db.familyMember.update({ where: { id: target.id }, data: body.data }) });
  } finally { await db.$disconnect(); }
});

families.delete('/members/:userId', authenticate, requireRoles('PARENT', 'ADMIN'), async (c) => {
  const db = createPrisma(c.env.DATABASE_URL);
  try {
    const userId = c.get('user').userId;
    const targetUserId = c.req.param('userId');
    if (targetUserId === userId) return c.json({ error: '不能移除自己' }, 400);
    const mine = await db.familyMember.findFirst({ where: { userId }, include: { family: true } });
    if (!mine || mine.family.ownerId !== userId) return c.json({ error: '只有家庭管理者可以管理成員' }, 403);
    const target = await db.familyMember.findFirst({ where: { familyId: mine.familyId, userId: targetUserId } });
    if (!target) return c.json({ error: '成員不存在' }, 404);
    await db.familyMember.delete({ where: { id: target.id } });
    return c.json({ success: true });
  } finally { await db.$disconnect(); }
});

export default families;

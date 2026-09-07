import { Hono } from 'hono';
import { monthlyChallengeSummary } from '../lib/challenge-report';
import { localParts, monthBounds } from '../lib/family-time';
import { createPrisma } from '../lib/worker-prisma';
import { authenticate, type WorkerRouteEnv } from './shared';

export function createReportRoutes(getDb = createPrisma) {
const reports = new Hono<WorkerRouteEnv>();

function summarize(transactions: any[], openingPoints: number) {
  const earned = transactions.filter((tx) => tx.type === 'EARN' || (tx.type === 'ADJUST' && tx.amount > 0)).reduce((sum, tx) => sum + tx.amount, 0);
  const rewardSpent = Math.abs(transactions.filter((tx) => tx.type === 'SPEND' && tx.reason.startsWith('兌換獎勵：')).reduce((sum, tx) => sum + tx.amount, 0));
  const allowanceSpent = Math.abs(transactions.filter((tx) => tx.type === 'SPEND' && tx.reason.startsWith('兌換零用錢：')).reduce((sum, tx) => sum + tx.amount, 0));
  const deducted = Math.abs(transactions.filter((tx) => tx.type === 'DEDUCT').reduce((sum, tx) => sum + tx.amount, 0));
  const reversed = transactions.filter((tx) => tx.type === 'REVERSAL').reduce((sum, tx) => sum + tx.amount, 0);
  const other = transactions.filter((tx) => !['EARN', 'DEDUCT', 'REVERSAL'].includes(tx.type) && !(tx.type === 'SPEND' && (tx.reason.startsWith('兌換獎勵：') || tx.reason.startsWith('兌換零用錢：')))).reduce((sum, tx) => sum + tx.amount, 0);
  return { openingPoints, earned, rewardSpent, allowanceSpent, deducted, reversed, other, closingPoints: openingPoints + transactions.reduce((sum, tx) => sum + tx.amount, 0) };
}

reports.get('/monthly', authenticate, async (c) => {
  const db = getDb(c.env.DATABASE_URL);
  try {
    const actor = c.get('user');
    const mine = await db.familyMember.findFirst({ where: { userId: actor.userId }, include: { family: { include: { members: { include: { user: true } } } } } });
    if (!mine) return c.json({ error: '您尚未加入家庭' }, 403);
    const local = localParts(new Date(), mine.family.timezone);
    const month = c.req.query('month') ?? `${local.year}-${String(local.month).padStart(2, '0')}`;
    let bounds;
    try { bounds = monthBounds(month, mine.family.timezone); } catch { return c.json({ error: '月份格式必須為 YYYY-MM' }, 400); }
    const requestedUserId = c.req.query('userId');
    if (actor.role === 'CHILD' && requestedUserId && requestedUserId !== actor.userId) return c.json({ error: '只能查看自己的月報' }, 403);
    const children = mine.family.members.filter((member: any) => member.user.role === 'CHILD');
    const targetIds = actor.role === 'CHILD' ? [actor.userId] : requestedUserId ? [requestedUserId] : children.map((member: any) => member.userId);
    if (targetIds.some((id) => !mine.family.members.some((member: any) => member.userId === id))) return c.json({ error: '無權查看此成員' }, 403);
    const childReports = [];
    for (const userId of targetIds) {
      const member = mine.family.members.find((item: any) => item.userId === userId)!;
      const [before, transactions, approvedTasks, rejectedTasks, trophies, allowance] = await Promise.all([
        db.pointTransaction.aggregate({ where: { userId, createdAt: { lt: bounds.start } }, _sum: { amount: true } }),
        db.pointTransaction.findMany({ where: { userId, createdAt: { gte: bounds.start, lt: bounds.end } }, orderBy: { createdAt: 'asc' } }),
        db.taskCompletion.findMany({ where: { userId, status: 'APPROVED', reviewedAt: { gte: bounds.start, lt: bounds.end } }, include: { task: true }, orderBy: { reviewedAt: 'asc' } }),
        db.taskCompletion.count({ where: { userId, status: 'REJECTED', reviewedAt: { gte: bounds.start, lt: bounds.end } } }),
        db.userTrophy.findMany({ where: { userId, unlockedAt: { gte: bounds.start, lt: bounds.end } }, include: { trophy: true }, orderBy: { unlockedAt: 'asc' } }),
        db.allowanceRedemption.findMany({ where: { userId, status: 'APPROVED', reviewedAt: { gte: bounds.start, lt: bounds.end } }, orderBy: { reviewedAt: 'asc' } }),
      ]);
      childReports.push({
        challengeSummary: await monthlyChallengeSummary(db,userId,bounds.start,bounds.end),
        user: { id: member.user.id, name: member.user.name },
        summary: summarize(transactions, before._sum.amount ?? 0),
        taskSummary: { approvedCount: approvedTasks.length, rejectedCount: rejectedTasks, totalPoints: approvedTasks.reduce((sum: number, item: any) => sum + (item.pointsSnapshot ?? item.task.points), 0), topTasks: [...new Set(approvedTasks.map((item: any) => item.titleSnapshot ?? item.task.title))].slice(0, 5) },
        allowanceTwd: allowance.reduce((sum: number, item: any) => sum + item.amountTwd, 0),
        trophies,
        transactions: actor.role === 'CHILD' ? transactions.filter((tx: any) => tx.type !== 'ADJUST') : transactions,
      });
    }
    const familySummary = childReports.reduce((sum: any, report: any) => ({ earned: sum.earned + report.summary.earned, spent: sum.spent + report.summary.rewardSpent + report.summary.allowanceSpent, deducted: sum.deducted + report.summary.deducted, tasks: sum.tasks + report.taskSummary.approvedCount, allowanceTwd: sum.allowanceTwd + report.allowanceTwd, trophies: sum.trophies + report.trophies.length }), { earned: 0, spent: 0, deducted: 0, tasks: 0, allowanceTwd: 0, trophies: 0 });
    return c.json({ month, timezone: mine.family.timezone, family: { id: mine.family.id, name: mine.family.name }, familySummary, children: childReports });
  } finally { await db.$disconnect(); }
});

return reports;
}
export default createReportRoutes();

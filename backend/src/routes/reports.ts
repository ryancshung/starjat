import { Router, Response } from 'express';
import { monthlyChallengeSummary } from '../lib/challenge-report';
import { prisma } from '../lib/prisma';
import { localParts, monthBounds } from '../lib/family-time';
import { authenticate, type AuthRequest } from '../middleware/auth';

const router = Router();
function summarize(transactions: any[], openingPoints: number) {
  const earned = transactions.filter((tx) => tx.type === 'EARN' || (tx.type === 'ADJUST' && tx.amount > 0)).reduce((sum, tx) => sum + tx.amount, 0);
  const rewardSpent = Math.abs(transactions.filter((tx) => tx.type === 'SPEND' && tx.reason.startsWith('兌換獎勵：')).reduce((sum, tx) => sum + tx.amount, 0));
  const allowanceSpent = Math.abs(transactions.filter((tx) => tx.type === 'SPEND' && tx.reason.startsWith('兌換零用錢：')).reduce((sum, tx) => sum + tx.amount, 0));
  const deducted = Math.abs(transactions.filter((tx) => tx.type === 'DEDUCT').reduce((sum, tx) => sum + tx.amount, 0));
  const reversed = transactions.filter((tx) => tx.type === 'REVERSAL').reduce((sum, tx) => sum + tx.amount, 0);
  return { openingPoints, earned, rewardSpent, allowanceSpent, deducted, reversed, closingPoints: openingPoints + transactions.reduce((sum, tx) => sum + tx.amount, 0) };
}

router.get('/monthly', authenticate, async (req: AuthRequest, res: Response) => {
  const mine = await prisma.familyMember.findFirst({ where: { userId: req.user!.userId }, include: { family: { include: { members: { include: { user: true } } } } } });
  if (!mine) return void res.status(403).json({ error: '您尚未加入家庭' });
  const local = localParts(new Date(), mine.family.timezone);
  const month = String(req.query.month ?? `${local.year}-${String(local.month).padStart(2, '0')}`);
  let bounds;
  try { bounds = monthBounds(month, mine.family.timezone); } catch { return void res.status(400).json({ error: '月份格式必須為 YYYY-MM' }); }
  const requested = req.query.userId ? String(req.query.userId) : null;
  if (req.user!.role === 'CHILD' && requested && requested !== req.user!.userId) return void res.status(403).json({ error: '只能查看自己的月報' });
  const children = mine.family.members.filter((member) => member.user.role === 'CHILD');
  const targetIds = req.user!.role === 'CHILD' ? [req.user!.userId] : requested ? [requested] : children.map((member) => member.userId);
  if (targetIds.some((id) => !mine.family.members.some((member) => member.userId === id))) return void res.status(403).json({ error: '無權查看此成員' });
  const childReports = [];
  for (const userId of targetIds) {
    const member = mine.family.members.find((item) => item.userId === userId)!;
    const [before, transactions, approvedTasks, rejectedTasks, trophies, allowance] = await Promise.all([
      prisma.pointTransaction.aggregate({ where: { userId, createdAt: { lt: bounds.start } }, _sum: { amount: true } }),
      prisma.pointTransaction.findMany({ where: { userId, createdAt: { gte: bounds.start, lt: bounds.end } }, orderBy: { createdAt: 'asc' } }),
      prisma.taskCompletion.findMany({ where: { userId, status: 'APPROVED', reviewedAt: { gte: bounds.start, lt: bounds.end } }, include: { task: true } }),
      prisma.taskCompletion.count({ where: { userId, status: 'REJECTED', reviewedAt: { gte: bounds.start, lt: bounds.end } } }),
      prisma.userTrophy.findMany({ where: { userId, unlockedAt: { gte: bounds.start, lt: bounds.end } }, include: { trophy: true } }),
      prisma.allowanceRedemption.findMany({ where: { userId, status: 'APPROVED', reviewedAt: { gte: bounds.start, lt: bounds.end } } }),
    ]);
    childReports.push({ challengeSummary: await monthlyChallengeSummary(prisma,userId,bounds.start,bounds.end), user: { id: member.user.id, name: member.user.name }, summary: summarize(transactions, before._sum.amount ?? 0), taskSummary: { approvedCount: approvedTasks.length, rejectedCount: rejectedTasks, totalPoints: approvedTasks.reduce((sum, item) => sum + (item.pointsSnapshot ?? item.task.points), 0), topTasks: [...new Set(approvedTasks.map((item) => item.titleSnapshot ?? item.task.title))].slice(0, 5) }, allowanceTwd: allowance.reduce((sum, item) => sum + item.amountTwd, 0), trophies, transactions: req.user!.role === 'CHILD' ? transactions.filter((tx) => tx.type !== 'ADJUST') : transactions });
  }
  const familySummary = childReports.reduce((sum, report) => ({ earned: sum.earned + report.summary.earned, spent: sum.spent + report.summary.rewardSpent + report.summary.allowanceSpent, deducted: sum.deducted + report.summary.deducted, tasks: sum.tasks + report.taskSummary.approvedCount, allowanceTwd: sum.allowanceTwd + report.allowanceTwd, trophies: sum.trophies + report.trophies.length }), { earned: 0, spent: 0, deducted: 0, tasks: 0, allowanceTwd: 0, trophies: 0 });
  res.json({ month, timezone: mine.family.timezone, family: { id: mine.family.id, name: mine.family.name }, familySummary, children: childReports });
});

export default router;

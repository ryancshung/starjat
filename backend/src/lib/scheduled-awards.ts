import { nextScheduledRun } from './family-time';
import { createPrisma, type WorkerEnv } from './worker-prisma';

export async function runScheduledAwards(env: WorkerEnv) {
  const db = createPrisma(env.DATABASE_URL);
  try {
    await processScheduledAwards(db);
  } finally { await db.$disconnect(); }
}

export async function processScheduledAwards(db: any) {
  try {
    const now = new Date();
    const schedules = await db.scheduledAward.findMany({ where: { isActive: true, startAt: { lte: now }, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] }, include: { family: true } });
    for (const schedule of schedules) {
      const nextRunAt = nextScheduledRun(schedule, schedule.family.timezone, now);
      await db.$transaction(async (tx: any) => {
        const claimed = await tx.scheduledAward.updateMany({ where: { id: schedule.id, updatedAt: schedule.updatedAt }, data: { lastPaidAt: now, nextRunAt } });
        if (!claimed.count) return;
        const before = await tx.user.findUnique({ where: { id: schedule.userId }, select: { points: true } });
        const user = await tx.user.update({ where: { id: schedule.userId }, data: { points: { increment: schedule.amount } } });
        await tx.pointTransaction.create({ data: { userId: schedule.userId, amount: schedule.amount, type: 'EARN', reason: `定期派發：${schedule.name}`, createdBy: schedule.createdById, balanceBefore: before?.points ?? 0, balanceAfter: user.points } });
      });
    }
  } catch (error) {
    console.error('定期派發執行失敗', error);
    throw error;
  }
}

import { createPrisma, type WorkerEnv } from './worker-prisma';

function due(frequency: string, lastPaidAt: Date | null, now: Date) {
  if (!lastPaidAt) return true;
  const elapsed = now.getTime() - lastPaidAt.getTime();
  if (frequency === 'daily') return elapsed >= 24 * 60 * 60 * 1000;
  if (frequency === 'weekly') return elapsed >= 7 * 24 * 60 * 60 * 1000;
  return now.getUTCFullYear() !== lastPaidAt.getUTCFullYear() || now.getUTCMonth() !== lastPaidAt.getUTCMonth();
}

export async function runScheduledAwards(env: WorkerEnv) {
  const db = createPrisma(env.DATABASE_URL);
  try {
    const now = new Date();
    const schedules = await db.scheduledAward.findMany({ where: { isActive: true, startAt: { lte: now } } });
    for (const schedule of schedules) {
      if (!due(schedule.frequency, schedule.lastPaidAt, now)) continue;
      await db.$transaction([
        db.user.update({ where: { id: schedule.userId }, data: { points: { increment: schedule.amount } } }),
        db.pointTransaction.create({ data: { userId: schedule.userId, amount: schedule.amount, type: 'EARN', reason: `定期派發：${schedule.name}`, createdBy: schedule.createdById } }),
        db.scheduledAward.update({ where: { id: schedule.id }, data: { lastPaidAt: now } }),
      ]);
    }
  } finally { await db.$disconnect(); }
}

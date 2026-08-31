import { localParts, zonedTimeToUtc } from './family-time';

type RewardAvailability = {
  availabilityMode: string;
  availableStartTime: string | null;
  availableEndTime: string | null;
  availableDates?: { date: string }[];
};

export function rewardAvailability(reward: RewardAvailability, timezone: string, now = new Date()) {
  const local = localParts(now, timezone);
  const dateMatch = reward.availableDates?.some((item) => item.date === local.date) ?? false;
  const weekendMatch = local.weekday === 0 || local.weekday === 6;
  const dayAllowed = reward.availabilityMode === 'ALWAYS'
    || (reward.availabilityMode === 'WEEKENDS' && weekendMatch)
    || (reward.availabilityMode === 'DATES' && dateMatch)
    || (reward.availabilityMode === 'WEEKENDS_OR_DATES' && (weekendMatch || dateMatch));
  const timeAllowed = (!reward.availableStartTime || local.time >= reward.availableStartTime)
    && (!reward.availableEndTime || local.time <= reward.availableEndTime);
  const available = dayAllowed && timeAllowed;
  let reason: string | null = null;
  if (!dayAllowed) {
    reason = reward.availabilityMode === 'WEEKENDS'
      ? '僅週六、週日開放'
      : reward.availabilityMode === 'DATES'
        ? '僅在指定日期開放'
        : '僅在週末或指定日期開放';
  } else if (!timeAllowed) {
    reason = `開放時段 ${reward.availableStartTime ?? '00:00'}–${reward.availableEndTime ?? '23:59'}`;
  }
  let nextAvailableAt: string | null = available ? now.toISOString() : null;
  if (!available) {
    const cursor = new Date(Date.UTC(local.year, local.month - 1, local.day));
    for (let offset = 0; offset < 370; offset += 1) {
      const day = new Date(cursor.getTime() + offset * 86400000);
      const date = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
      const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
      const exact = reward.availableDates?.some((item) => item.date === date) ?? false;
      const matches = reward.availabilityMode === 'ALWAYS'
        || (reward.availabilityMode === 'WEEKENDS' && weekend)
        || (reward.availabilityMode === 'DATES' && exact)
        || (reward.availabilityMode === 'WEEKENDS_OR_DATES' && (weekend || exact));
      if (!matches) continue;
      const [hour, minute] = (reward.availableStartTime ?? '00:00').split(':').map(Number);
      const candidate = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, timezone);
      if (candidate > now) { nextAvailableAt = candidate.toISOString(); break; }
      if (offset === 0 && (!reward.availableEndTime || local.time <= reward.availableEndTime)) { nextAvailableAt = now.toISOString(); break; }
    }
  }
  return { available, reason, checkedAt: now.toISOString(), localDate: local.date, nextAvailableAt };
}

export function effectiveRewardCost(reward: {
  cost: number;
  discountPercent: number | null;
  discountStart: Date | null;
  discountEnd: Date | null;
}, now = new Date()) {
  const discountActive = Boolean(
    reward.discountPercent
    && (!reward.discountStart || reward.discountStart <= now)
    && (!reward.discountEnd || reward.discountEnd >= now),
  );
  return discountActive
    ? Math.ceil(reward.cost * (100 - (reward.discountPercent ?? 0)) / 100)
    : reward.cost;
}

export async function reservedPoints(db: any, userId: string) {
  const [rewards, allowance] = await Promise.all([
    db.rewardRedemption.aggregate({ where: { userId, status: 'PENDING' }, _sum: { reservedPoints: true } }),
    db.allowanceRedemption.aggregate({ where: { userId, status: 'PENDING' }, _sum: { reservedPoints: true } }),
  ]);
  return (rewards._sum.reservedPoints ?? 0) + (allowance._sum.reservedPoints ?? 0);
}

export async function pointBalance(db: any, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { points: true } });
  const reserved = await reservedPoints(db, userId);
  const points = user?.points ?? 0;
  return { points, reservedPoints: reserved, availablePoints: Math.max(0, points - reserved) };
}

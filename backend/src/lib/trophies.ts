const builtIns = [
  { id: 'system-first-task', title: '第一道星光', description: '第一次完成並通過任務', tier: 'BRONZE', iconKey: 'sparkles', triggerType: 'TASK_APPROVED_COUNT', threshold: 1 },
  { id: 'system-ten-tasks', title: '任務新星', description: '累積完成 10 次任務', tier: 'SILVER', iconKey: 'check', triggerType: 'TASK_APPROVED_COUNT', threshold: 10 },
  { id: 'system-hundred-tasks', title: '百次達成', description: '累積完成 100 次任務', tier: 'GOLD', iconKey: 'crown', triggerType: 'TASK_APPROVED_COUNT', threshold: 100 },
  { id: 'system-hundred-points', title: '星星收藏家', description: '累積獲得 100 顆星星', tier: 'SILVER', iconKey: 'star', triggerType: 'POINTS_EARNED', threshold: 100 },
  { id: 'system-first-redemption', title: '第一次兌換', description: '完成第一次獎勵或零用錢兌換', tier: 'BRONZE', iconKey: 'gift', triggerType: 'REWARD_APPROVED_COUNT', threshold: 1 },
  { id: 'system-first-wish', title: '願望成真', description: '第一個願望獲得家長核准', tier: 'BRONZE', iconKey: 'heart', triggerType: 'WISH_APPROVED_COUNT', threshold: 1 },
  { id: 'system-stellar', title: '星耀全能', description: '累積完成 250 次任務', tier: 'STELLAR', iconKey: 'gem', triggerType: 'TASK_APPROVED_COUNT', threshold: 250 },
];

export async function ensureSystemTrophies(db: any) {
  for (const item of builtIns) {
    await db.trophyDefinition.upsert({ where: { id: item.id }, update: {}, create: { ...item, scope: 'SYSTEM' } });
  }
}

export async function trophyProgress(db: any, userId: string, triggerType: string) {
  if (triggerType === 'TASK_APPROVED_COUNT') return db.taskCompletion.count({ where: { userId, status: 'APPROVED' } });
  if (triggerType === 'POINTS_EARNED') {
    const result = await db.pointTransaction.aggregate({ where: { userId, amount: { gt: 0 }, type: { in: ['EARN', 'ADJUST'] } }, _sum: { amount: true } });
    return result._sum.amount ?? 0;
  }
  if (triggerType === 'REWARD_APPROVED_COUNT') {
    const [rewards, allowance] = await Promise.all([db.rewardRedemption.count({ where: { userId, status: 'APPROVED' } }), db.allowanceRedemption.count({ where: { userId, status: 'APPROVED' } })]);
    return rewards + allowance;
  }
  if (triggerType === 'WISH_APPROVED_COUNT') return db.wish.count({ where: { userId, status: 'APPROVED' } });
  return 0;
}

export async function evaluateTrophies(db: any, userId: string, source: 'AUTOMATIC' | 'RETROACTIVE' = 'AUTOMATIC') {
  await ensureSystemTrophies(db);
  const member = await db.familyMember.findFirst({ where: { userId } });
  if (!member) return [];
  const definitions = await db.trophyDefinition.findMany({ where: { isActive: true, triggerType: { not: 'MANUAL' }, OR: [{ scope: 'SYSTEM' }, { familyId: member.familyId }] } });
  const unlocked = [];
  for (const definition of definitions) {
    const progress = await trophyProgress(db, userId, definition.triggerType);
    if (progress < definition.threshold) continue;
    const result = await db.userTrophy.upsert({ where: { trophyId_userId: { trophyId: definition.id, userId } }, update: {}, create: { trophyId: definition.id, userId, source } });
    unlocked.push(result);
  }
  return unlocked;
}

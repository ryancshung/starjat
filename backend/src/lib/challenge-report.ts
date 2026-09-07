import type { PrismaClient } from '@prisma/client';

export async function monthlyChallengeSummary(db: PrismaClient, userId: string, start: Date, end: Date) {
  const awards=await db.challengeAward.findMany({where:{userId,earnedAt:{gte:start,lt:end}},orderBy:{earnedAt:'asc'}});
  return {bonusStars:awards.reduce((sum,a)=>sum+a.bonusStars,0),awards};
}

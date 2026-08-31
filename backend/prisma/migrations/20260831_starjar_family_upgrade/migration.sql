ALTER TABLE "Family" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Taipei';
ALTER TABLE "Family" ADD COLUMN "pointsPerTwd" INTEGER;

ALTER TABLE "FamilyMember" ADD COLUMN "canDeductPoints" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FamilyMember" ADD COLUMN "monthlyAllowanceLimitTwd" INTEGER;

ALTER TABLE "PointTransaction" ADD COLUMN "balanceBefore" INTEGER;
ALTER TABLE "PointTransaction" ADD COLUMN "balanceAfter" INTEGER;
ALTER TABLE "PointTransaction" ADD COLUMN "reversalOfId" TEXT;

ALTER TABLE "ScheduledAward" ADD COLUMN "localTime" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "ScheduledAward" ADD COLUMN "weekday" INTEGER;
ALTER TABLE "ScheduledAward" ADD COLUMN "dayOfMonth" INTEGER;
ALTER TABLE "ScheduledAward" ADD COLUMN "nextRunAt" TIMESTAMP(3);

ALTER TABLE "Reward" ADD COLUMN "availabilityMode" TEXT NOT NULL DEFAULT 'ALWAYS';
ALTER TABLE "Reward" ADD COLUMN "availableStartTime" TEXT;
ALTER TABLE "Reward" ADD COLUMN "availableEndTime" TEXT;

ALTER TABLE "RewardRedemption" ADD COLUMN "reservedPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RewardRedemption" ADD COLUMN "costSnapshot" INTEGER;
ALTER TABLE "RewardRedemption" ADD COLUMN "availabilitySnapshot" TEXT;
ALTER TABLE "RewardRedemption" ADD COLUMN "cancelledAt" TIMESTAMP(3);

UPDATE "RewardRedemption" AS redemption
SET "reservedPoints" = reward."cost", "costSnapshot" = reward."cost"
FROM "Reward" AS reward
WHERE redemption."rewardId" = reward."id" AND redemption."status" = 'PENDING';

CREATE TABLE "RewardAvailabilityDate" (
  "id" TEXT NOT NULL,
  "rewardId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  CONSTRAINT "RewardAvailabilityDate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RewardAvailabilityDate_rewardId_date_key" ON "RewardAvailabilityDate"("rewardId", "date");
ALTER TABLE "RewardAvailabilityDate" ADD CONSTRAINT "RewardAvailabilityDate_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AllowanceRedemption" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountTwd" INTEGER NOT NULL,
  "pointsPerTwdSnapshot" INTEGER NOT NULL,
  "reservedPoints" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "AllowanceRedemption_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AllowanceRedemption_familyId_status_idx" ON "AllowanceRedemption"("familyId", "status");
CREATE INDEX "AllowanceRedemption_userId_createdAt_idx" ON "AllowanceRedemption"("userId", "createdAt");
ALTER TABLE "AllowanceRedemption" ADD CONSTRAINT "AllowanceRedemption_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllowanceRedemption" ADD CONSTRAINT "AllowanceRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TrophyDefinition" (
  "id" TEXT NOT NULL,
  "familyId" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'FAMILY',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "iconKey" TEXT NOT NULL DEFAULT 'trophy',
  "isSecret" BOOLEAN NOT NULL DEFAULT false,
  "triggerType" TEXT NOT NULL,
  "threshold" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrophyDefinition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TrophyDefinition_scope_familyId_isActive_idx" ON "TrophyDefinition"("scope", "familyId", "isActive");
ALTER TABLE "TrophyDefinition" ADD CONSTRAINT "TrophyDefinition_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserTrophy" (
  "id" TEXT NOT NULL,
  "trophyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "awardedBy" TEXT,
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTrophy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserTrophy_trophyId_userId_key" ON "UserTrophy"("trophyId", "userId");
CREATE INDEX "UserTrophy_userId_unlockedAt_idx" ON "UserTrophy"("userId", "unlockedAt");
ALTER TABLE "UserTrophy" ADD CONSTRAINT "UserTrophy_trophyId_fkey" FOREIGN KEY ("trophyId") REFERENCES "TrophyDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTrophy" ADD CONSTRAINT "UserTrophy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Run preflight.sql first. Stop rather than silently alter conflicting history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "TaskCompletion" WHERE "status" = 'PENDING'
    GROUP BY "taskId", "userId" HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate pending task submissions: run preflight.sql and resolve explicitly before migrating';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "public"."TaskCompletion" ADD COLUMN     "activeKey" TEXT,
ADD COLUMN     "localDate" TEXT,
ADD COLUMN     "pointsSnapshot" INTEGER,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "titleSnapshot" TEXT;

-- CreateTable
CREATE TABLE "public"."DailyTaskVersion" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "effectiveDate" TEXT NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "DailyTaskVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyChallenge" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DailyChallengeVersion" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "effectiveDate" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "taskIds" JSONB NOT NULL,
    "childIds" JSONB NOT NULL,
    "bonusStars" INTEGER NOT NULL,
    "customTitle" TEXT,
    "customDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DailyChallengeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TaskDaySnapshot" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "tasks" JSONB NOT NULL,
    "challenges" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDaySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChallengeAward" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bonusStars" INTEGER NOT NULL,
    "customTitle" TEXT,
    "customDescription" TEXT,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledBy" TEXT,

    CONSTRAINT "ChallengeAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyTaskVersion_familyId_effectiveDate_idx" ON "public"."DailyTaskVersion"("familyId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTaskVersion_taskId_effectiveDate_key" ON "public"."DailyTaskVersion"("taskId", "effectiveDate");

-- CreateIndex
CREATE INDEX "DailyChallenge_familyId_idx" ON "public"."DailyChallenge"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyChallengeVersion_challengeId_effectiveDate_key" ON "public"."DailyChallengeVersion"("challengeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "TaskDaySnapshot_familyId_localDate_idx" ON "public"."TaskDaySnapshot"("familyId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDaySnapshot_familyId_userId_localDate_key" ON "public"."TaskDaySnapshot"("familyId", "userId", "localDate");

-- CreateIndex
CREATE INDEX "ChallengeAward_familyId_userId_earnedAt_idx" ON "public"."ChallengeAward"("familyId", "userId", "earnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeAward_challengeId_userId_localDate_key" ON "public"."ChallengeAward"("challengeId", "userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCompletion_activeKey_key" ON "public"."TaskCompletion"("activeKey");

-- CreateIndex
CREATE INDEX "TaskCompletion_userId_localDate_status_idx" ON "public"."TaskCompletion"("userId", "localDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCompletion_userId_requestId_key" ON "public"."TaskCompletion"("userId", "requestId");

-- AddForeignKey
ALTER TABLE "public"."DailyChallengeVersion" ADD CONSTRAINT "DailyChallengeVersion_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "public"."DailyChallenge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TaskSubmissionRequest" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "completionId" TEXT NOT NULL REFERENCES "TaskCompletion"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TaskSubmissionRequest_userId_requestId_key" ON "TaskSubmissionRequest"("userId","requestId");

-- Read-only. Any result in the first query blocks migration; never delete history automatically.
SELECT "taskId", "userId", COUNT(*) AS "pendingCount", array_agg("id") AS "completionIds"
FROM "TaskCompletion" WHERE "status" = 'PENDING'
GROUP BY "taskId", "userId" HAVING COUNT(*) > 1;

-- Historical daily duplicates are reported, not backfilled or charged back.
SELECT c."taskId", c."userId", (c."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE f."timezone")::date AS "date",
  COUNT(*) AS "approvedCount", array_agg(c."id") AS "completionIds"
FROM "TaskCompletion" c JOIN "Task" t ON t."id"=c."taskId" JOIN "Family" f ON f."id"=t."familyId"
WHERE c."status"='APPROVED' AND t."isRecurring" AND t."recurringType"='daily'
GROUP BY c."taskId",c."userId",(c."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE f."timezone")::date
HAVING COUNT(*) > 1;

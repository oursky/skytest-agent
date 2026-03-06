ALTER TABLE "UsageRecord"
ADD COLUMN "actorUserId" TEXT,
ADD COLUMN "projectId" TEXT;

DELETE FROM "UsageRecord"
WHERE "testRunId" IS NULL;

UPDATE "UsageRecord" ur
SET
    "actorUserId" = ur."userId",
    "projectId" = tc."projectId"
FROM "TestRun" tr
JOIN "TestCase" tc ON tc."id" = tr."testCaseId"
WHERE ur."testRunId" = tr."id";

DELETE FROM "UsageRecord"
WHERE "actorUserId" IS NULL
   OR "projectId" IS NULL;

ALTER TABLE "UsageRecord"
ALTER COLUMN "actorUserId" SET NOT NULL,
ALTER COLUMN "projectId" SET NOT NULL;

ALTER TABLE "UsageRecord" DROP CONSTRAINT "UsageRecord_userId_fkey";

DROP INDEX "UsageRecord_userId_createdAt_idx";

ALTER TABLE "UsageRecord"
DROP COLUMN "userId";

CREATE INDEX "UsageRecord_projectId_createdAt_idx" ON "UsageRecord"("projectId", "createdAt" DESC);
CREATE INDEX "UsageRecord_actorUserId_createdAt_idx" ON "UsageRecord"("actorUserId", "createdAt" DESC);
CREATE INDEX "UsageRecord_projectId_actorUserId_createdAt_idx" ON "UsageRecord"("projectId", "actorUserId", "createdAt" DESC);

ALTER TABLE "UsageRecord"
ADD CONSTRAINT "UsageRecord_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "UsageRecord"
ADD CONSTRAINT "UsageRecord_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

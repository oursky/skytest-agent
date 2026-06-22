ALTER TABLE "TestCase" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TEST';

DROP INDEX IF EXISTS "TestCase_projectId_updatedAt_idx";
CREATE INDEX "TestCase_projectId_kind_updatedAt_idx" ON "TestCase"("projectId", "kind", "updatedAt" DESC);

-- AlterTable
ALTER TABLE "TestRun"
ADD COLUMN "instanceId" TEXT,
ADD COLUMN "instanceName" TEXT,
ADD COLUMN "instanceType" TEXT;

-- CreateIndex
CREATE INDEX "TestRun_instanceType_instanceName_createdAt_idx"
ON "TestRun"("instanceType", "instanceName", "createdAt" DESC);

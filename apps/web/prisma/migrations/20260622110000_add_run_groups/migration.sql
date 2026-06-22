-- AlterTable
ALTER TABLE "RunSession" ADD COLUMN "runGroupId" TEXT;

-- CreateTable
CREATE TABLE "RunGroup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayId" TEXT,
    "loginFlowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunGroupItem" (
    "id" TEXT NOT NULL,
    "runGroupId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "RunGroupItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RunGroup_projectId_updatedAt_idx" ON "RunGroup"("projectId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "RunGroupItem_runGroupId_position_idx" ON "RunGroupItem"("runGroupId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RunGroupItem_runGroupId_testCaseId_key" ON "RunGroupItem"("runGroupId", "testCaseId");

-- CreateIndex
CREATE INDEX "RunSession_runGroupId_createdAt_idx" ON "RunSession"("runGroupId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "RunSession" ADD CONSTRAINT "RunSession_runGroupId_fkey" FOREIGN KEY ("runGroupId") REFERENCES "RunGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunGroup" ADD CONSTRAINT "RunGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunGroupItem" ADD CONSTRAINT "RunGroupItem_runGroupId_fkey" FOREIGN KEY ("runGroupId") REFERENCES "RunGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunGroupItem" ADD CONSTRAINT "RunGroupItem_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

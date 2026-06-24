-- Soft-delete test groups so completed GROUP run sessions keep their group linkage
-- (RunSession.testGroupId stays set instead of being nulled on a hard delete).
ALTER TABLE "TestGroup" ADD COLUMN "deletedAt" TIMESTAMP(3);

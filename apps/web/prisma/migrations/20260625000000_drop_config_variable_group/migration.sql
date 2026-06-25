-- Remove the variable group feature: drop the optional group column from config tables.
ALTER TABLE "ProjectConfig" DROP COLUMN IF EXISTS "group";
ALTER TABLE "TestCaseConfig" DROP COLUMN IF EXISTS "group";

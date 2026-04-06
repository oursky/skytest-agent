DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Team'
      AND column_name = 'aiProvider'
      AND udt_name = 'AiProvider'
  ) THEN
    ALTER TABLE "Team"
      ALTER COLUMN "aiProvider" TYPE TEXT USING "aiProvider"::TEXT;
  END IF;
END $$;

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "aiProvider" TEXT;

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "aiBaseUrl" TEXT;

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "aiMainModel" TEXT;

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "aiPlanningModel" TEXT;

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "aiInsightModel" TEXT;

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "aiTemperature" DOUBLE PRECISION;

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "aiConfigUpdatedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Team'
      AND column_name = 'aiModelMain'
  ) THEN
    EXECUTE 'UPDATE "Team" SET "aiMainModel" = COALESCE("aiMainModel", "aiModelMain")';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Team'
      AND column_name = 'aiModelPlanning'
  ) THEN
    EXECUTE 'UPDATE "Team" SET "aiPlanningModel" = COALESCE("aiPlanningModel", "aiModelPlanning")';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Team'
      AND column_name = 'aiModelInsight'
  ) THEN
    EXECUTE 'UPDATE "Team" SET "aiInsightModel" = COALESCE("aiInsightModel", "aiModelInsight")';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Team'
      AND column_name = 'aiApiKeyEncrypted'
  ) THEN
    EXECUTE 'UPDATE "Team" SET "openRouterKeyEncrypted" = COALESCE("openRouterKeyEncrypted", "aiApiKeyEncrypted")';
  END IF;
END $$;

UPDATE "Team"
SET "aiProvider" = 'openrouter'
WHERE "aiProvider" IS NULL;

ALTER TABLE "Team"
  ALTER COLUMN "aiProvider" SET DEFAULT 'openrouter';

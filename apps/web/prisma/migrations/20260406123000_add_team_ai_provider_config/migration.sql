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
  ADD COLUMN IF NOT EXISTS "aiProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "aiBaseUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "aiMainModel" TEXT,
  ADD COLUMN IF NOT EXISTS "aiMainModelFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "aiPlanningModel" TEXT,
  ADD COLUMN IF NOT EXISTS "aiPlanningModelFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "aiInsightModel" TEXT,
  ADD COLUMN IF NOT EXISTS "aiInsightModelFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "aiTemperature" DOUBLE PRECISION,
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
SET "aiProvider" = 'OPENROUTER'
WHERE "aiProvider" = 'openrouter' OR "aiProvider" IS NULL;

UPDATE "Team"
SET "aiProvider" = 'OPENAI'
WHERE "aiProvider" = 'openai-compatible' OR "aiProvider" = 'openai';

ALTER TABLE "Team"
  ALTER COLUMN "aiProvider" SET DEFAULT 'OPENROUTER';

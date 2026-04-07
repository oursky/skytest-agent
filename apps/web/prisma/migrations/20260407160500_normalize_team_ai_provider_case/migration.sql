UPDATE "Team"
SET "aiProvider" = 'OPENROUTER'
WHERE "aiProvider" = 'openrouter' OR "aiProvider" IS NULL;

ALTER TABLE "Team"
  ALTER COLUMN "aiProvider" SET DEFAULT 'OPENROUTER';

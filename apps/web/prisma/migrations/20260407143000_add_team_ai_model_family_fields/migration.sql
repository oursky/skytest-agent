ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "aiMainModelFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "aiPlanningModelFamily" TEXT,
  ADD COLUMN IF NOT EXISTS "aiInsightModelFamily" TEXT;

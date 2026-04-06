ALTER TABLE "Team"
  ADD COLUMN "aiProvider" TEXT DEFAULT 'openrouter',
  ADD COLUMN "aiBaseUrl" TEXT,
  ADD COLUMN "aiMainModel" TEXT,
  ADD COLUMN "aiPlanningModel" TEXT,
  ADD COLUMN "aiInsightModel" TEXT,
  ADD COLUMN "aiTemperature" DOUBLE PRECISION,
  ADD COLUMN "aiConfigUpdatedAt" TIMESTAMP(3);

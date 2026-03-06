ALTER TABLE "Project"
ADD COLUMN "openRouterKeyEncrypted" TEXT,
ADD COLUMN "openRouterKeyUpdatedAt" TIMESTAMP(3),
ADD COLUMN "organizationId" TEXT;

WITH preferred_organizations AS (
    SELECT
        u."id" AS "userId",
        COALESCE(
            (
                SELECT om."organizationId"
                FROM "OrganizationMembership" om
                WHERE om."userId" = u."id"
                ORDER BY om."createdAt" ASC
                LIMIT 1
            ),
            'org_' || u."id"
        ) AS "organizationId",
        COALESCE(NULLIF(u."email", ''), 'Workspace ' || LEFT(u."id", 8)) AS "organizationName"
    FROM "User" u
)
INSERT INTO "Organization" ("id", "name", "createdAt", "updatedAt")
SELECT p."organizationId", p."organizationName", NOW(), NOW()
FROM preferred_organizations p
WHERE NOT EXISTS (
    SELECT 1
    FROM "Organization" o
    WHERE o."id" = p."organizationId"
);

WITH preferred_organizations AS (
    SELECT
        u."id" AS "userId",
        COALESCE(
            (
                SELECT om."organizationId"
                FROM "OrganizationMembership" om
                WHERE om."userId" = u."id"
                ORDER BY om."createdAt" ASC
                LIMIT 1
            ),
            'org_' || u."id"
        ) AS "organizationId"
    FROM "User" u
)
INSERT INTO "OrganizationMembership" ("id", "organizationId", "userId", "role", "createdAt", "updatedAt")
SELECT
    'om_' || p."organizationId" || '_' || p."userId",
    p."organizationId",
    p."userId",
    'OWNER'::"OrganizationRole",
    NOW(),
    NOW()
FROM preferred_organizations p
WHERE NOT EXISTS (
    SELECT 1
    FROM "OrganizationMembership" om
    WHERE om."organizationId" = p."organizationId"
      AND om."userId" = p."userId"
);

WITH preferred_organizations AS (
    SELECT
        u."id" AS "userId",
        COALESCE(
            (
                SELECT om."organizationId"
                FROM "OrganizationMembership" om
                WHERE om."userId" = u."id"
                ORDER BY om."createdAt" ASC
                LIMIT 1
            ),
            'org_' || u."id"
        ) AS "organizationId",
        u."openRouterKey" AS "openRouterKey"
    FROM "User" u
)
UPDATE "Project" p
SET
    "organizationId" = po."organizationId",
    "openRouterKeyEncrypted" = po."openRouterKey",
    "openRouterKeyUpdatedAt" = CASE WHEN po."openRouterKey" IS NULL THEN NULL ELSE NOW() END
FROM preferred_organizations po
WHERE po."userId" = p."userId";

INSERT INTO "ProjectMembership" ("id", "projectId", "userId", "role", "createdAt", "updatedAt")
SELECT
    'pm_' || p."id" || '_' || p."userId",
    p."id",
    p."userId",
    'ADMIN'::"ProjectRole",
    NOW(),
    NOW()
FROM "Project" p
WHERE NOT EXISTS (
    SELECT 1
    FROM "ProjectMembership" pm
    WHERE pm."projectId" = p."id"
      AND pm."userId" = p."userId"
);

ALTER TABLE "Project"
ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "Project_organizationId_updatedAt_idx" ON "Project"("organizationId", "updatedAt" DESC);

ALTER TABLE "Project"
ADD CONSTRAINT "Project_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "User"
DROP COLUMN "openRouterKey";

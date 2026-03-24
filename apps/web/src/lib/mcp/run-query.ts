import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import { objectStore } from '@/lib/storage/object-store';
import { isProjectMember, isTestCaseProjectMember } from '@/lib/security/permissions';

export type RunListInclude = 'events' | 'artifacts';
const RUN_EVENT_ROW_LIMIT = 100;

export interface ListTestRunsInput {
    projectId?: string;
    testCaseId?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
    include?: RunListInclude[];
}

interface ListRunEvent {
    sequence: number;
    kind: string;
    message: string | null;
    artifactKey: string | null;
    payload: unknown;
    createdAt: string;
}

interface ListRunArtifact {
    key: string;
    source: 'run-file' | 'event';
    filename: string;
    mimeType?: string;
    size?: number;
    createdAt?: string;
    signedUrl?: string;
}

interface RunListItem {
    id: string;
    testCaseId: string;
    status: string;
    error: string | null;
    requiredCapability: string | null;
    requestedDeviceId: string | null;
    requestedRunnerId: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    events?: ListRunEvent[];
    artifacts?: ListRunArtifact[];
}

export interface ListTestRunsResult {
    runs: RunListItem[];
    pagination: {
        limit: number;
        nextCursor: string | null;
    };
}

interface ValidationFailure {
    error: string;
    details?: unknown;
}

interface RunEventRow {
    runId: string;
    sequence: number;
    kind: string;
    message: string | null;
    artifactKey: string | null;
    payload: unknown;
    createdAt: Date;
}

function resolveArtifactFilename(artifactKey: string): string {
    const segments = artifactKey.split('/').filter(Boolean);
    return segments[segments.length - 1] || 'artifact.bin';
}

function parseDateInput(rawValue: string | undefined, field: 'from' | 'to'): Date | null {
    if (!rawValue) {
        return null;
    }

    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid ${field} date`);
    }
    return parsed;
}

function clampLimit(limit?: number): number {
    return Math.max(1, Math.min(limit ?? 20, 50));
}

async function signArtifactKey(key: string): Promise<string | undefined> {
    try {
        return await objectStore.getSignedDownloadUrl({
            key,
            filename: resolveArtifactFilename(key),
            inline: true,
        });
    } catch {
        return undefined;
    }
}

async function buildArtifactSignedUrlMap(keys: ReadonlySet<string>): Promise<Map<string, string | undefined>> {
    const entries = await Promise.all(Array.from(keys).map(async (key) => {
        const signedUrl = await signArtifactKey(key);
        return [key, signedUrl] as const;
    }));
    return new Map(entries);
}

async function listRunEvents(runIds: ReadonlyArray<string>): Promise<RunEventRow[]> {
    if (runIds.length === 0) {
        return [];
    }

    return prisma.$queryRaw<RunEventRow[]>(Prisma.sql`
        WITH ranked_events AS (
            SELECT
                tre."runId",
                tre.sequence,
                tre.kind,
                tre.message,
                tre."artifactKey",
                tre.payload,
                tre."createdAt",
                ROW_NUMBER() OVER (
                    PARTITION BY tre."runId"
                    ORDER BY tre.sequence ASC
                ) AS rn
            FROM "TestRunEvent" tre
            WHERE tre."runId" IN (${Prisma.join(runIds)})
        )
        SELECT
            re."runId",
            re.sequence,
            re.kind,
            re.message,
            re."artifactKey",
            re.payload,
            re."createdAt"
        FROM ranked_events re
        WHERE re.rn <= ${RUN_EVENT_ROW_LIMIT}
        ORDER BY re."runId" ASC, re.sequence ASC;
    `);
}

export async function listTestRuns(
    userId: string,
    input: ListTestRunsInput
): Promise<{ ok: true; data: ListTestRunsResult } | { ok: false; failure: ValidationFailure }> {
    if (input.projectId && !await isProjectMember(userId, input.projectId)) {
        return { ok: false, failure: { error: 'Forbidden' } };
    }

    if (input.testCaseId && !await isTestCaseProjectMember(userId, input.testCaseId)) {
        return { ok: false, failure: { error: 'Forbidden' } };
    }

    let fromDate: Date | null;
    let toDate: Date | null;
    try {
        fromDate = parseDateInput(input.from, 'from');
        toDate = parseDateInput(input.to, 'to');
    } catch (error) {
        return {
            ok: false,
            failure: {
                error: error instanceof Error ? error.message : 'Invalid date range'
            }
        };
    }

    if (fromDate && toDate && fromDate > toDate) {
        return {
            ok: false,
            failure: { error: 'from must be earlier than or equal to to' }
        };
    }

    const includeSet = new Set<RunListInclude>(input.include ?? []);
    const includeEvents = includeSet.has('events');
    const includeArtifacts = includeSet.has('artifacts');
    const take = clampLimit(input.limit);

    if (input.cursor) {
        const cursorRun = await prisma.testRun.findFirst({
            where: {
                id: input.cursor,
                deletedAt: null,
                testCase: {
                    project: {
                        team: {
                            memberships: {
                                some: { userId },
                            }
                        }
                    }
                }
            },
            select: { id: true }
        });

        if (!cursorRun) {
            return {
                ok: false,
                failure: { error: 'Invalid cursor' }
            };
        }
    }

    const runRows = await prisma.testRun.findMany({
        where: {
            deletedAt: null,
            ...(input.status ? { status: input.status } : {}),
            ...((fromDate || toDate)
                ? {
                    createdAt: {
                        ...(fromDate ? { gte: fromDate } : {}),
                        ...(toDate ? { lte: toDate } : {}),
                    }
                }
                : {}),
            testCase: {
                ...(input.testCaseId ? { id: input.testCaseId } : {}),
                project: {
                    ...(input.projectId ? { id: input.projectId } : {}),
                    team: {
                        memberships: {
                            some: { userId },
                        }
                    }
                }
            },
        },
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
        take: take + 1,
        ...(input.cursor ? {
            cursor: { id: input.cursor },
            skip: 1,
        } : {}),
        select: {
            id: true,
            testCaseId: true,
            status: true,
            error: true,
            requiredCapability: true,
            requestedDeviceId: true,
            requestedRunnerId: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            files: {
                select: {
                    storedName: true,
                    filename: true,
                    mimeType: true,
                    size: true,
                    createdAt: true,
                }
            }
        }
    });

    const hasMore = runRows.length > take;
    const rows = hasMore ? runRows.slice(0, take) : runRows;
    const runIds = rows.map((row) => row.id);
    const runIdsSet = new Set(runIds);

    const eventsByRunId = new Map<string, ListRunEvent[]>();
    if (includeEvents && runIds.length > 0) {
        const runEvents = await listRunEvents(runIds);
        for (const event of runEvents) {
            if (!runIdsSet.has(event.runId)) {
                continue;
            }

            const events = eventsByRunId.get(event.runId) ?? [];
            events.push({
                sequence: event.sequence,
                kind: event.kind,
                message: event.message,
                artifactKey: event.artifactKey,
                payload: event.payload,
                createdAt: event.createdAt.toISOString(),
            });
            eventsByRunId.set(event.runId, events);
        }
    }

    const artifactsByRunId = new Map<string, ListRunArtifact[]>();
    if (includeArtifacts && runIds.length > 0) {
        const artifactSignKeys = new Set<string>();

        for (const run of rows) {
            const fileArtifacts = run.files.map((file) => {
                artifactSignKeys.add(file.storedName);
                return {
                    key: file.storedName,
                    source: 'run-file' as const,
                    filename: file.filename,
                    mimeType: file.mimeType,
                    size: file.size,
                    createdAt: file.createdAt.toISOString(),
                };
            });
            artifactsByRunId.set(run.id, fileArtifacts);
        }

        const eventArtifacts = await prisma.testRunEvent.findMany({
            where: {
                runId: { in: runIds },
                artifactKey: { not: null },
            },
            orderBy: [
                { runId: 'asc' },
                { sequence: 'asc' },
            ],
            select: {
                runId: true,
                artifactKey: true,
                createdAt: true,
            }
        });

        const seenPerRun = new Map<string, Set<string>>();
        const eventArtifactCountPerRun = new Map<string, number>();
        for (const eventArtifact of eventArtifacts) {
            const key = eventArtifact.artifactKey;
            if (!key) {
                continue;
            }

            const runId = eventArtifact.runId;
            const perRunCount = eventArtifactCountPerRun.get(runId) ?? 0;
            if (perRunCount >= 100) {
                continue;
            }

            let seen = seenPerRun.get(runId);
            if (!seen) {
                seen = new Set<string>();
                seenPerRun.set(runId, seen);
            }
            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            eventArtifactCountPerRun.set(runId, perRunCount + 1);
            artifactSignKeys.add(key);

            const artifacts = artifactsByRunId.get(runId) ?? [];
            artifacts.push({
                key,
                source: 'event',
                filename: resolveArtifactFilename(key),
                createdAt: eventArtifact.createdAt.toISOString(),
            });
            artifactsByRunId.set(runId, artifacts);
        }

        const signedUrlByArtifactKey = await buildArtifactSignedUrlMap(artifactSignKeys);
        artifactsByRunId.forEach((artifacts, runId) => {
            const withSignedUrls = artifacts.map((artifact) => ({
                ...artifact,
                signedUrl: signedUrlByArtifactKey.get(artifact.key),
            }));
            artifactsByRunId.set(runId, withSignedUrls);
        });
    }

    const runs: RunListItem[] = rows.map((run) => ({
        id: run.id,
        testCaseId: run.testCaseId,
        status: run.status,
        error: run.error,
        requiredCapability: run.requiredCapability,
        requestedDeviceId: run.requestedDeviceId,
        requestedRunnerId: run.requestedRunnerId,
        startedAt: run.startedAt ? run.startedAt.toISOString() : null,
        completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        createdAt: run.createdAt.toISOString(),
        ...(includeEvents ? { events: eventsByRunId.get(run.id) || [] } : {}),
        ...(includeArtifacts ? { artifacts: artifactsByRunId.get(run.id) || [] } : {}),
    }));

    return {
        ok: true,
        data: {
            runs,
            pagination: {
                limit: take,
                nextCursor: hasMore ? rows[rows.length - 1]?.id ?? null : null,
            }
        }
    };
}

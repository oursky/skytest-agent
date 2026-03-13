import { prisma } from '@/lib/core/prisma';
import { objectStore } from '@/lib/storage/object-store';
import { isProjectMember, isTestCaseProjectMember } from '@/lib/security/permissions';

export type RunListInclude = 'events' | 'artifacts';

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

    const eventsByRunId = new Map<string, ListRunEvent[]>();
    if (includeEvents && runIds.length > 0) {
        await Promise.all(rows.map(async (run) => {
            const runEvents = await prisma.testRunEvent.findMany({
                where: { runId: run.id },
                orderBy: { sequence: 'asc' },
                take: 100,
                select: {
                    sequence: true,
                    kind: true,
                    message: true,
                    artifactKey: true,
                    payload: true,
                    createdAt: true,
                }
            });

            eventsByRunId.set(run.id, runEvents.map((event) => ({
                sequence: event.sequence,
                kind: event.kind,
                message: event.message,
                artifactKey: event.artifactKey,
                payload: event.payload,
                createdAt: event.createdAt.toISOString(),
            })));
        }));
    }

    const artifactsByRunId = new Map<string, ListRunArtifact[]>();
    if (includeArtifacts && runIds.length > 0) {
        await Promise.all(rows.map(async (run) => {
            const artifacts: ListRunArtifact[] = [];

            for (const file of run.files) {
                artifacts.push({
                    key: file.storedName,
                    source: 'run-file',
                    filename: file.filename,
                    mimeType: file.mimeType,
                    size: file.size,
                    createdAt: file.createdAt.toISOString(),
                    signedUrl: await signArtifactKey(file.storedName),
                });
            }

            const eventArtifacts = await prisma.testRunEvent.findMany({
                where: {
                    runId: run.id,
                    artifactKey: { not: null },
                },
                orderBy: { sequence: 'asc' },
                take: 100,
                select: {
                    artifactKey: true,
                    createdAt: true,
                }
            });

            const seen = new Set<string>();
            for (const eventArtifact of eventArtifacts) {
                const key = eventArtifact.artifactKey;
                if (!key || seen.has(key)) {
                    continue;
                }
                seen.add(key);

                artifacts.push({
                    key,
                    source: 'event',
                    filename: resolveArtifactFilename(key),
                    createdAt: eventArtifact.createdAt.toISOString(),
                    signedUrl: await signArtifactKey(key),
                });
            }

            artifactsByRunId.set(run.id, artifacts);
        }));
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

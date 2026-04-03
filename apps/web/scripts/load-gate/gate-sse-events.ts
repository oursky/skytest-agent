import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../src/lib/core/prisma';
import { issueStreamToken } from '../../src/lib/security/stream-token';

type LoadProfile = 'smoke' | 'standard' | 'stress';

interface ProfileDefaults {
    runCount: number;
    clientsPerRun: number;
    eventBurstPerSecond: number;
    durationMs: number;
}

interface RunScope {
    runIds: string[];
    userId: string;
    cleanup: (() => Promise<void>) | null;
}

interface GateConfig {
    baseUrl: string;
    profile: LoadProfile;
    runCount: number;
    clientsPerRun: number;
    eventBurstPerSecond: number;
    durationMs: number;
    emitIntervalMs: number;
    reportFilePath: string;
    dryRun: boolean;
    seedMode: boolean;
    seedPrefix: string;
    runIdsFromEnv: string[];
    userIdFromEnv: string | null;
}

interface MutableMetrics {
    targetConnections: number;
    successfulInitialConnections: number;
    reconnectCount: number;
    connectionAttemptCount: number;
    connectionStatusCounts: Record<string, number>;
    streamErrors: number;
    eventsReceived: number;
    orderingViolations: number;
    latenciesMs: number[];
}

const PROFILE_DEFAULTS: Record<LoadProfile, ProfileDefaults> = {
    smoke: {
        runCount: 5,
        clientsPerRun: 1,
        eventBurstPerSecond: 2,
        durationMs: 30_000,
    },
    standard: {
        runCount: 20,
        clientsPerRun: 2,
        eventBurstPerSecond: 5,
        durationMs: 120_000,
    },
    stress: {
        runCount: 50,
        clientsPerRun: 3,
        eventBurstPerSecond: 10,
        durationMs: 180_000,
    },
};

function parseBoundedIntEnv(input: {
    name: string;
    fallback: number;
    min: number;
    max: number;
}): number {
    const parsed = Number.parseInt(process.env[input.name] ?? '', 10);
    if (!Number.isFinite(parsed)) {
        return input.fallback;
    }
    return Math.min(input.max, Math.max(input.min, parsed));
}

function parseProfileEnv(): LoadProfile {
    const value = (process.env.LOAD_GATE_SSE_PROFILE ?? 'standard').trim().toLowerCase();
    if (value === 'smoke' || value === 'stress') {
        return value;
    }
    return 'standard';
}

function parseCommaSeparated(value: string | undefined): string[] {
    if (!value) {
        return [];
    }
    return Array.from(new Set(
        value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
    ));
}

function percentile(values: number[], percentileValue: number): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1));
    return sorted[rank];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function buildConfig(): GateConfig {
    const profile = parseProfileEnv();
    const defaults = PROFILE_DEFAULTS[profile];

    return {
        baseUrl: (process.env.LOAD_GATE_SSE_BASE_URL ?? 'http://127.0.0.1:3000').trim().replace(/\/+$/, ''),
        profile,
        runCount: parseBoundedIntEnv({
            name: 'LOAD_GATE_SSE_RUN_COUNT',
            fallback: defaults.runCount,
            min: 1,
            max: 200,
        }),
        clientsPerRun: parseBoundedIntEnv({
            name: 'LOAD_GATE_SSE_CLIENTS_PER_RUN',
            fallback: defaults.clientsPerRun,
            min: 1,
            max: 10,
        }),
        eventBurstPerSecond: parseBoundedIntEnv({
            name: 'LOAD_GATE_SSE_EVENT_BURST',
            fallback: defaults.eventBurstPerSecond,
            min: 1,
            max: 100,
        }),
        durationMs: parseBoundedIntEnv({
            name: 'LOAD_GATE_SSE_DURATION_MS',
            fallback: defaults.durationMs,
            min: 5_000,
            max: 600_000,
        }),
        emitIntervalMs: parseBoundedIntEnv({
            name: 'LOAD_GATE_SSE_EMIT_INTERVAL_MS',
            fallback: 1_000,
            min: 100,
            max: 5_000,
        }),
        reportFilePath: process.env.LOAD_GATE_SSE_REPORT_FILE ?? '/tmp/skytest-sse-gate.json',
        dryRun: process.env.LOAD_GATE_SSE_DRY_RUN === '1' || process.env.LOAD_GATE_SSE_DRY_RUN === 'true',
        seedMode: process.env.LOAD_GATE_SSE_SEED_MODE === '1' || process.env.LOAD_GATE_SSE_SEED_MODE === 'true',
        seedPrefix: process.env.LOAD_GATE_SSE_SEED_PREFIX?.trim() || `load-gate-sse-${Date.now()}`,
        runIdsFromEnv: parseCommaSeparated(process.env.LOAD_GATE_SSE_RUN_IDS),
        userIdFromEnv: process.env.LOAD_GATE_SSE_USER_ID?.trim() || null,
    };
}

async function ensureParentDirectory(filePath: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
}

async function seedScope(config: GateConfig): Promise<RunScope> {
    const user = await prisma.user.create({
        data: {
            authId: `${config.seedPrefix}-auth`,
            email: `${config.seedPrefix}@example.invalid`,
        },
        select: { id: true },
    });

    const team = await prisma.team.create({
        data: {
            name: `${config.seedPrefix}-team`,
        },
        select: { id: true },
    });

    await prisma.teamMembership.create({
        data: {
            teamId: team.id,
            userId: user.id,
            role: 'OWNER',
        },
    });

    const project = await prisma.project.create({
        data: {
            name: `${config.seedPrefix}-project`,
            teamId: team.id,
            createdByUserId: user.id,
            maxConcurrentRuns: Math.max(1, config.runCount),
        },
        select: { id: true },
    });

    const testCase = await prisma.testCase.create({
        data: {
            name: `${config.seedPrefix}-test-case`,
            projectId: project.id,
            displayId: `${config.seedPrefix.slice(-6).toUpperCase()}-SSE`,
            url: 'about:blank',
            prompt: 'SSE load-gate seed run',
            status: 'DRAFT',
        },
        select: { id: true },
    });

    await prisma.testRun.createMany({
        data: Array.from({ length: config.runCount }, () => ({
            testCaseId: testCase.id,
            status: 'PREPARING',
            startedAt: new Date(),
        })),
    });

    const seededRuns = await prisma.testRun.findMany({
        where: { testCaseId: testCase.id },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
    });

    return {
        runIds: seededRuns.map((run) => run.id),
        userId: user.id,
        cleanup: async () => {
            await prisma.team.delete({ where: { id: team.id } });
            await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
        },
    };
}

async function resolveScope(config: GateConfig): Promise<RunScope> {
    if (config.seedMode) {
        return seedScope(config);
    }

    if (config.runIdsFromEnv.length === 0) {
        throw new Error('LOAD_GATE_SSE_RUN_IDS is required when LOAD_GATE_SSE_SEED_MODE is not enabled.');
    }
    if (!config.userIdFromEnv) {
        throw new Error('LOAD_GATE_SSE_USER_ID is required when using existing run IDs.');
    }

    return {
        runIds: config.runIdsFromEnv,
        userId: config.userIdFromEnv,
        cleanup: null,
    };
}

async function issueRunStreamToken(runId: string, userId: string, durationMs: number): Promise<string> {
    const expiresInSeconds = Math.max(60, Math.ceil(durationMs / 1000) + 60);
    return issueStreamToken({
        userId,
        scope: 'test-run-events',
        resourceId: runId,
        expiresInSeconds,
    });
}

function parseSseFrames(buffer: string): { frames: string[]; rest: string } {
    const parts = buffer.split('\n\n');
    if (parts.length <= 1) {
        return { frames: [], rest: buffer };
    }

    const rest = parts.pop() ?? '';
    return { frames: parts, rest };
}

function extractSseData(frame: string): string | null {
    const lines = frame.split('\n');
    const dataLines = lines
        .map((line) => line.trimEnd())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
        return null;
    }
    return dataLines.join('\n');
}

function ingestStreamPayload(input: {
    payload: unknown;
    metrics: MutableMetrics;
    lastSequence: { value: number };
}) {
    const payloadRecord = asRecord(input.payload);
    if (!payloadRecord) {
        return;
    }

    if (payloadRecord.type !== 'log') {
        return;
    }

    const data = asRecord(payloadRecord.data);
    if (!data) {
        return;
    }

    input.metrics.eventsReceived += 1;

    const sequence = typeof data.seq === 'number' ? data.seq : null;
    if (sequence !== null) {
        if (sequence <= input.lastSequence.value) {
            input.metrics.orderingViolations += 1;
        }
        input.lastSequence.value = Math.max(input.lastSequence.value, sequence);
    }

    const emittedAtMs = typeof data.emittedAtMs === 'number' ? data.emittedAtMs : null;
    if (emittedAtMs !== null) {
        input.metrics.latenciesMs.push(Date.now() - emittedAtMs);
    }
}

async function openClientStream(input: {
    baseUrl: string;
    runId: string;
    userId: string;
    deadlineMs: number;
    metrics: MutableMetrics;
}): Promise<void> {
    const { baseUrl, runId, userId, deadlineMs, metrics } = input;
    const lastSequence = { value: 0 };
    let firstConnectionSucceeded = false;

    while (Date.now() < deadlineMs) {
        metrics.connectionAttemptCount += 1;
        const token = await issueRunStreamToken(runId, userId, deadlineMs - Date.now());
        const response = await fetch(`${baseUrl}/api/test-runs/${runId}/events?streamToken=${encodeURIComponent(token)}`);
        const statusKey = String(response.status);
        metrics.connectionStatusCounts[statusKey] = (metrics.connectionStatusCounts[statusKey] ?? 0) + 1;

        if (!response.ok || !response.body) {
            metrics.streamErrors += 1;
            return;
        }

        if (!firstConnectionSucceeded) {
            metrics.successfulInitialConnections += 1;
            firstConnectionSucceeded = true;
        } else {
            metrics.reconnectCount += 1;
        }

        const reader = response.body.getReader();
        let textBuffer = '';
        let reachedTerminalStatus = false;

        while (Date.now() < deadlineMs) {
            let readResult: ReadableStreamReadResult<Uint8Array>;
            try {
                readResult = await reader.read();
            } catch {
                metrics.streamErrors += 1;
                break;
            }

            if (readResult.done) {
                break;
            }

            textBuffer += new TextDecoder().decode(readResult.value, { stream: true });
            const { frames, rest } = parseSseFrames(textBuffer);
            textBuffer = rest;

            for (const frame of frames) {
                const rawData = extractSseData(frame);
                if (!rawData) {
                    continue;
                }

                let parsed: unknown;
                try {
                    parsed = JSON.parse(rawData);
                } catch {
                    continue;
                }

                ingestStreamPayload({
                    payload: parsed,
                    metrics,
                    lastSequence,
                });

                const record = asRecord(parsed);
                if (record?.type === 'status') {
                    const status = typeof record.status === 'string' ? record.status : null;
                    if (status === 'PASS' || status === 'FAIL' || status === 'CANCELLED') {
                        reachedTerminalStatus = true;
                    }
                }
            }
        }

        await reader.cancel().catch(() => undefined);
        if (reachedTerminalStatus) {
            return;
        }
    }
}

async function initializeSequenceMap(runIds: string[]): Promise<Map<string, number>> {
    const grouped = await prisma.testRunEvent.groupBy({
        by: ['runId'],
        where: {
            runId: { in: runIds },
        },
        _max: {
            sequence: true,
        },
    });

    const map = new Map<string, number>();
    for (const runId of runIds) {
        map.set(runId, 1);
    }
    for (const row of grouped) {
        map.set(row.runId, (row._max.sequence ?? 0) + 1);
    }
    return map;
}

async function emitRunEvents(input: {
    runIds: string[];
    sequenceMap: Map<string, number>;
    eventBurstPerSecond: number;
    emitIntervalMs: number;
    durationMs: number;
}): Promise<number> {
    const { runIds, sequenceMap, eventBurstPerSecond, emitIntervalMs, durationMs } = input;
    const startedAtMs = Date.now();
    let emittedEvents = 0;
    let tick = 0;

    await prisma.testRun.updateMany({
        where: { id: { in: runIds } },
        data: {
            status: 'RUNNING',
            startedAt: new Date(),
        },
    });

    while (Date.now() - startedAtMs < durationMs) {
        tick += 1;

        for (const runId of runIds) {
            const events = [];
            const nextSequence = sequenceMap.get(runId) ?? 1;

            for (let index = 0; index < eventBurstPerSecond; index += 1) {
                const sequence = nextSequence + index;
                const emittedAtMs = Date.now();
                events.push({
                    runId,
                    sequence,
                    kind: 'LOG',
                    message: `SSE load-gate event ${sequence}`,
                    payload: {
                        type: 'log',
                        timestamp: emittedAtMs,
                        data: {
                            message: `SSE load-gate event ${sequence}`,
                            level: 'info',
                            seq: sequence,
                            emittedAtMs,
                            tick,
                        },
                    },
                    createdAt: new Date(emittedAtMs),
                });
            }

            if (events.length > 0) {
                await prisma.testRunEvent.createMany({ data: events });
                sequenceMap.set(runId, nextSequence + events.length);
                emittedEvents += events.length;
            }
        }

        await new Promise((resolve) => setTimeout(resolve, emitIntervalMs));
    }

    await prisma.testRun.updateMany({
        where: { id: { in: runIds } },
        data: {
            status: 'PASS',
            completedAt: new Date(),
        },
    });

    return emittedEvents;
}

function evaluateStandardProfileThresholds(input: {
    metrics: MutableMetrics;
    totalEventsEmitted: number;
}) {
    const {
        metrics,
        totalEventsEmitted,
    } = input;

    const expectedEvents = totalEventsEmitted * Math.max(1, metrics.successfulInitialConnections);
    const lossRatio = expectedEvents === 0
        ? 1
        : Math.max(0, (expectedEvents - metrics.eventsReceived) / expectedEvents);
    const setupSuccessRate = metrics.targetConnections === 0
        ? 0
        : metrics.successfulInitialConnections / metrics.targetConnections;
    const totalAttempts = Math.max(1, metrics.connectionAttemptCount);
    const http5xxCount = Object.entries(metrics.connectionStatusCounts).reduce((sum, [status, count]) => (
        status.startsWith('5') ? sum + count : sum
    ), 0);
    const server5xxRatio = http5xxCount / totalAttempts;

    const p95 = percentile(metrics.latenciesMs, 95);
    const p99 = percentile(metrics.latenciesMs, 99);

    return {
        setupSuccessRate,
        lossRatio,
        p95,
        p99,
        server5xxRatio,
        pass:
            setupSuccessRate >= 0.99
            && lossRatio <= 0.001
            && metrics.orderingViolations === 0
            && p95 <= 1500
            && p99 <= 3000
            && server5xxRatio <= 0.001,
    };
}

async function main() {
    const config = buildConfig();
    const scope = await resolveScope(config);
    const metrics: MutableMetrics = {
        targetConnections: scope.runIds.length * config.clientsPerRun,
        successfulInitialConnections: 0,
        reconnectCount: 0,
        connectionAttemptCount: 0,
        connectionStatusCounts: {},
        streamErrors: 0,
        eventsReceived: 0,
        orderingViolations: 0,
        latenciesMs: [],
    };

    if (config.dryRun) {
        const dryReport = {
            dryRun: true,
            profile: config.profile,
            runCount: scope.runIds.length,
            clientsPerRun: config.clientsPerRun,
            eventBurstPerSecond: config.eventBurstPerSecond,
            durationMs: config.durationMs,
            emitIntervalMs: config.emitIntervalMs,
            baseUrl: config.baseUrl,
            reportFilePath: config.reportFilePath,
            seedMode: config.seedMode,
            runIds: scope.runIds,
            userId: scope.userId,
        };
        await ensureParentDirectory(config.reportFilePath);
        await writeFile(config.reportFilePath, JSON.stringify(dryReport, null, 2), 'utf8');
        console.log(JSON.stringify(dryReport));
        if (scope.cleanup) {
            await scope.cleanup();
        }
        return;
    }

    const startedAtMs = Date.now();
    const sequenceMap = await initializeSequenceMap(scope.runIds);
    const deadlineMs = startedAtMs + config.durationMs + 5_000;

    const connectionPromises = [];
    for (const runId of scope.runIds) {
        for (let i = 0; i < config.clientsPerRun; i += 1) {
            connectionPromises.push(openClientStream({
                baseUrl: config.baseUrl,
                runId,
                userId: scope.userId,
                deadlineMs,
                metrics,
            }));
        }
    }

    const totalEventsEmitted = await emitRunEvents({
        runIds: scope.runIds,
        sequenceMap,
        eventBurstPerSecond: config.eventBurstPerSecond,
        emitIntervalMs: config.emitIntervalMs,
        durationMs: config.durationMs,
    });

    await Promise.allSettled(connectionPromises);

    const thresholdResult = evaluateStandardProfileThresholds({
        metrics,
        totalEventsEmitted,
    });

    const report = {
        profile: config.profile,
        durationMs: Date.now() - startedAtMs,
        targetConnections: metrics.targetConnections,
        successfulConnections: metrics.successfulInitialConnections,
        connectionAttempts: metrics.connectionAttemptCount,
        reconnectCount: metrics.reconnectCount,
        statusDistribution: metrics.connectionStatusCounts,
        streamErrorCount: metrics.streamErrors,
        totalEventsEmitted,
        totalEventsReceived: metrics.eventsReceived,
        orderingViolations: metrics.orderingViolations,
        latencyMs: {
            p50: percentile(metrics.latenciesMs, 50),
            p95: thresholdResult.p95,
            p99: thresholdResult.p99,
        },
        setupSuccessRate: thresholdResult.setupSuccessRate,
        eventLossRatio: thresholdResult.lossRatio,
        server5xxRatio: thresholdResult.server5xxRatio,
        pass: thresholdResult.pass,
        runIds: scope.runIds,
    };

    await ensureParentDirectory(config.reportFilePath);
    await writeFile(config.reportFilePath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report));

    if (!thresholdResult.pass) {
        throw new Error('SSE load gate thresholds failed for the current profile.');
    }

    if (scope.cleanup) {
        await scope.cleanup();
    }
}

void main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

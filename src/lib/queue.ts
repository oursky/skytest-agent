import { prisma } from '@/lib/prisma';
import { runTest } from './test-runner';
import { TestEvent, RunTestOptions } from '@/types';
import { config as appConfig } from '@/config/app';
import { getErrorMessage } from './errors';
import { UsageService } from './usage';
import { createLogger } from './logger';
import { publishProjectEvent } from '@/lib/project-events';

const logger = createLogger('queue');

interface Job {
    runId: string;
    config: RunTestOptions['config'];
    controller: AbortController;
}

type CleanupFn = () => Promise<void>;
type QueueRunStatus = 'QUEUED' | 'PREPARING' | 'RUNNING' | 'PASS' | 'FAIL' | 'CANCELLED';
interface CancelRunOptions {
    errorMessage: string;
    testCaseId?: string;
    projectId?: string;
    resultJson?: string;
    clearLogsField?: boolean;
}

export class TestQueue {
    private static instance: TestQueue;
    private queue: Job[] = [];
    private running: Map<string, Job> = new Map();
    private activeStatuses: Map<string, 'PREPARING' | 'RUNNING'> = new Map();
    private cleanupFns: Map<string, CleanupFn> = new Map();
    private concurrency = appConfig.queue.concurrency;
    private logs: Map<string, TestEvent[]> = new Map();
    private persistTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private persistedIndexes: Map<string, number> = new Map();

    private constructor() { }

    public async startup(): Promise<void> {
        try {
            const staleRuns = await prisma.testRun.findMany({
                where: { status: { in: ['RUNNING', 'QUEUED', 'PREPARING'] } },
                select: { id: true, testCaseId: true }
            });

            if (staleRuns.length > 0) {
                logger.info(`Marking ${staleRuns.length} stale run(s) as FAIL on startup`);
                await prisma.testRun.updateMany({
                    where: { id: { in: staleRuns.map(r => r.id) } },
                    data: { status: 'FAIL', error: 'Server restarted while test was in progress', completedAt: new Date() }
                });

                const staleTestCaseIds = [...new Set(staleRuns.map(r => r.testCaseId).filter(Boolean))] as string[];
                if (staleTestCaseIds.length > 0) {
                    await prisma.testCase.updateMany({
                        where: { id: { in: staleTestCaseIds } },
                        data: { status: 'FAIL' }
                    });
                }
            }
        } catch (e) {
            logger.error('Failed to cleanup stale runs on startup', e);
        }
    }

    public static getInstance(): TestQueue {
        if (!TestQueue.instance) {
            TestQueue.instance = new TestQueue();
        }
        return TestQueue.instance;
    }

    public async add(runId: string, config: RunTestOptions['config']) {
        const controller = new AbortController();
        const job: Job = { runId, config, controller };

        this.queue.push(job);

        this.logs.set(runId, []);
        this.persistedIndexes.set(runId, 0);

        try {
            await prisma.testRun.update({
                where: { id: runId },
                data: { status: 'QUEUED' }
            });
            await this.updateTestCaseStatus(config.testCaseId, 'QUEUED');
        } catch (e) {
            logger.error(`Failed to update status for ${runId}`, e);
        }

        this.publishRunStatus(config.projectId, config.testCaseId, runId, 'QUEUED');

        this.processNext();
    }

    public registerCleanup(runId: string, cleanup: CleanupFn) {
        this.cleanupFns.set(runId, cleanup);
    }

    private publishRunStatus(projectId: string | undefined, testCaseId: string | undefined, runId: string, status: QueueRunStatus) {
        if (!projectId || !testCaseId) {
            return;
        }
        publishProjectEvent(projectId, {
            type: 'test-run-status',
            testCaseId,
            runId,
            status
        });
    }

    private async updateTestCaseStatus(testCaseId: string | undefined, status: QueueRunStatus): Promise<void> {
        if (!testCaseId) {
            return;
        }
        await prisma.testCase.update({
            where: { id: testCaseId },
            data: { status }
        });
    }

    private async syncActiveRunStatus(runId: string, config: RunTestOptions['config'], status: 'PREPARING' | 'RUNNING'): Promise<void> {
        this.activeStatuses.set(runId, status);
        await prisma.testRun.update({ where: { id: runId }, data: { status } });
        await this.updateTestCaseStatus(config.testCaseId, status);
        this.publishRunStatus(config.projectId, config.testCaseId, runId, status);
    }

    private async markRunCancelled(runId: string, options: CancelRunOptions): Promise<void> {
        const data: {
            status: 'CANCELLED';
            error: string;
            completedAt: Date;
            result?: string;
            logs?: null;
        } = {
            status: 'CANCELLED',
            error: options.errorMessage,
            completedAt: new Date(),
        };
        if (options.resultJson !== undefined) {
            data.result = options.resultJson;
        }
        if (options.clearLogsField) {
            data.logs = null;
        }

        await prisma.testRun.update({
            where: { id: runId },
            data
        });

        await this.updateTestCaseStatus(options.testCaseId, 'CANCELLED');
        this.publishRunStatus(options.projectId, options.testCaseId, runId, 'CANCELLED');
    }

    public async cancel(runId: string) {
        if (this.running.has(runId)) {
            const job = this.running.get(runId)!;

            job.controller.abort();

            const cleanup = this.cleanupFns.get(runId);
            if (cleanup) {
                try {
                    await cleanup();
                } catch (e) {
                    logger.error(`Failed to cleanup ${runId}`, e);
                }
                this.cleanupFns.delete(runId);
            }

            this.running.delete(runId);
            this.activeStatuses.delete(runId);
            this.processNext();

            const logBuffer = this.logs.get(runId) || [];
            try {
                await this.markRunCancelled(runId, {
                    errorMessage: 'Test stopped by user',
                    testCaseId: job.config.testCaseId,
                    projectId: job.config.projectId,
                    resultJson: JSON.stringify(logBuffer),
                    clearLogsField: true,
                });
            } catch (e) {
                logger.error(`Failed to mark ${runId} as cancelled`, e);
            }

        } else {
            const index = this.queue.findIndex(j => j.runId === runId);
            if (index !== -1) {
                const job = this.queue[index];
                this.queue.splice(index, 1);

                try {
                    await this.markRunCancelled(runId, {
                        errorMessage: 'Cancelled while queued',
                        testCaseId: job.config.testCaseId,
                        projectId: job.config.projectId,
                    });
                } catch (error) {
                    logger.error(`Failed to mark ${runId} as cancelled`, error);
                }

                this.logs.delete(runId);
                this.persistedIndexes.delete(runId);
            } else {
                try {
                    const run = await prisma.testRun.findUnique({
                        where: { id: runId },
                        select: {
                            status: true,
                            testCaseId: true,
                            testCase: { select: { projectId: true } }
                        }
                    });

                    if (run && ['RUNNING', 'QUEUED', 'PREPARING'].includes(run.status)) {
                        await this.markRunCancelled(runId, {
                            errorMessage: 'Force cancelled (orphaned run)',
                            testCaseId: run.testCaseId ?? undefined,
                            projectId: run.testCase?.projectId,
                        });
                    }
                } catch (error) {
                    logger.error(`Failed to cleanup orphaned run ${runId}`, error);
                }
                this.persistedIndexes.delete(runId);
            }
        }
    }

    public getEvents(runId: string): TestEvent[] {
        return this.logs.get(runId) || [];
    }

    public getStatus(runId: string) {
        const activeStatus = this.activeStatuses.get(runId);
        if (activeStatus) return activeStatus;
        const inQueue = this.queue.find(j => j.runId === runId);
        if (inQueue) return 'QUEUED';
        return null;
    }

    private getStartStatus(config: RunTestOptions['config']): 'PREPARING' | 'RUNNING' {
        const hasAndroidTarget = Object.values(config.browserConfig ?? {}).some(
            (target) => 'type' in target && target.type === 'android'
        );
        return hasAndroidTarget ? 'PREPARING' : 'RUNNING';
    }

    private async processNext() {
        if (this.running.size >= this.concurrency) return;

        const job = this.queue.shift();
        if (!job) return;

        this.running.set(job.runId, job);
        const startStatus = this.getStartStatus(job.config);
        this.activeStatuses.set(job.runId, startStatus);

        try {
            await prisma.testRun.update({
                where: { id: job.runId },
                data: {
                    status: startStatus,
                    startedAt: new Date()
                }
            });

            await this.updateTestCaseStatus(job.config.testCaseId, startStatus);

            this.publishRunStatus(job.config.projectId, job.config.testCaseId, job.runId, startStatus);
        } catch (error) {
            logger.error(`Failed to mark job ${job.runId} as ${startStatus}`, error);
        }

        void this.executeJob(job).catch((error) => {
            logger.error(`Unhandled queue execution rejection for ${job.runId}`, error);
        });

        void this.processNext();
    }

    private serializeEventsChunk(events: TestEvent[]): string {
        if (events.length === 0) return '';
        return events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    }

    private schedulePersistEvents(runId: string) {
        if (this.persistTimers.has(runId)) {
            return;
        }

        const timer = setTimeout(async () => {
            this.persistTimers.delete(runId);
            const events = this.logs.get(runId);
            if (!events) return;
            const persistedIndex = this.persistedIndexes.get(runId) ?? 0;
            if (persistedIndex >= events.length) return;

            const chunk = this.serializeEventsChunk(events.slice(persistedIndex));
            if (!chunk) return;

            try {
                await prisma.$executeRaw`
                    UPDATE "TestRun"
                    SET "logs" = COALESCE("logs", '') || ${chunk}
                    WHERE "id" = ${runId}
                `;
                this.persistedIndexes.set(runId, events.length);
            } catch (error) {
                logger.warn(`Failed to persist live events for ${runId}`, error);
            }
        }, 1000);

        this.persistTimers.set(runId, timer);
    }

    private async executeJob(job: Job) {
        const { runId, config, controller } = job;
        const logBuffer = this.logs.get(runId) || [];
        const userId = config.userId;
        let screenshotCount = 0;

        try {
            const result = await runTest({
                runId,
                config,
                signal: controller.signal,
                onEvent: (event) => {
                    if (logBuffer.length >= appConfig.queue.maxEventsPerRun) {
                        return;
                    }

                    if (event.type === 'screenshot') {
                        if (screenshotCount >= appConfig.queue.maxScreenshotsPerRun) {
                            return;
                        }
                        screenshotCount += 1;
                    }

                    logBuffer.push(event);
                    this.schedulePersistEvents(runId);
                },
                onCleanup: (cleanup) => {
                    this.registerCleanup(runId, cleanup);
                },
                onPreparing: async () => {
                    await this.syncActiveRunStatus(runId, config, 'PREPARING');
                },
                onRunning: async () => {
                    if (this.activeStatuses.get(runId) === 'RUNNING') {
                        return;
                    }
                    await this.syncActiveRunStatus(runId, config, 'RUNNING');
                }
            });

            const current = await prisma.testRun.findUnique({
                where: { id: runId },
                select: { status: true }
            });
            if (current?.status === 'CANCELLED') {
                logger.info(`Skipping final result update for cancelled run ${runId}`);
                return;
            }

            await prisma.testRun.update({
                where: { id: runId },
                data: {
                    status: result.status,
                    error: result.error,
                    result: JSON.stringify(logBuffer),
                    logs: null,
                    completedAt: new Date()
                }
            });

            await this.updateTestCaseStatus(config.testCaseId, result.status as QueueRunStatus);

            this.publishRunStatus(config.projectId, config.testCaseId, runId, result.status as QueueRunStatus);

            logger.info('Test completed', {
                runId,
                userId,
                actionCount: result.actionCount
            });
            if (userId && result.actionCount && result.actionCount > 0) {
                try {
                    const description = await this.buildUsageDescription(runId);
                    logger.debug('Recording usage', {
                        runId,
                        userId,
                        actionCount: result.actionCount,
                        description
                    });
                    await UsageService.recordUsage(userId, result.actionCount, description, runId);
                    logger.debug('Usage recorded', { runId, userId });
                } catch (err) {
                    logger.warn('Failed to record usage', err);
                }
            } else {
                logger.debug('Skipping usage recording', {
                    runId,
                    hasUserId: Boolean(userId),
                    actionCount: result.actionCount
                });
            }

        } catch (err) {
            logger.error(`Unexpected error in job ${runId}`, err);

            const current = await prisma.testRun.findUnique({ where: { id: runId }, select: { status: true } });
            if (current?.status !== 'CANCELLED') {
                await prisma.testRun.update({
                    where: { id: runId },
                    data: {
                        status: 'FAIL',
                        error: getErrorMessage(err),
                        result: JSON.stringify(logBuffer),
                        logs: null,
                        completedAt: new Date()
                    }
                });

                await this.updateTestCaseStatus(config.testCaseId, 'FAIL');

                this.publishRunStatus(config.projectId, config.testCaseId, runId, 'FAIL');
            }
        } finally {
            this.running.delete(runId);
            this.activeStatuses.delete(runId);
            this.cleanupFns.delete(runId);
            this.persistedIndexes.delete(runId);
            const pendingTimer = this.persistTimers.get(runId);
            if (pendingTimer) {
                clearTimeout(pendingTimer);
                this.persistTimers.delete(runId);
            }
            setTimeout(() => {
                this.logs.delete(runId);
            }, appConfig.queue.logRetentionMs);

            this.processNext();
        }
    }

    private async buildUsageDescription(runId: string): Promise<string> {
        const testRun = await prisma.testRun.findUnique({
            where: { id: runId },
            include: {
                testCase: {
                    include: {
                        project: true
                    }
                }
            }
        });

        if (!testRun?.testCase) {
            return 'Test Run';
        }

        const projectName = testRun.testCase.project?.name || 'Unknown Project';
        const testCaseName = testRun.testCase.name;

        return `${projectName} - ${testCaseName}`;
    }
}

export const queue = TestQueue.getInstance();

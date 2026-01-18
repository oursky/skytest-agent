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

export class TestQueue {
    private static instance: TestQueue;
    private queue: Job[] = [];
    private running: Map<string, Job> = new Map();
    private cleanupFns: Map<string, CleanupFn> = new Map();
    private concurrency = appConfig.queue.concurrency;
    private logs: Map<string, TestEvent[]> = new Map();

    private constructor() { }

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

        try {
            await prisma.testRun.update({
                where: { id: runId },
                data: { status: 'QUEUED' }
            });
        } catch (e) {
            logger.error(`Failed to update status for ${runId}`, e);
        }

        if (config.projectId && config.testCaseId) {
            publishProjectEvent(config.projectId, {
                type: 'test-run-status',
                testCaseId: config.testCaseId,
                runId,
                status: 'QUEUED'
            });
        }

        this.processNext();
    }

    public registerCleanup(runId: string, cleanup: CleanupFn) {
        this.cleanupFns.set(runId, cleanup);
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
            this.processNext();

            const logBuffer = this.logs.get(runId) || [];
            try {
                await prisma.testRun.update({
                    where: { id: runId },
                    data: {
                        status: 'CANCELLED',
                        error: 'Test stopped by user',
                        completedAt: new Date(),
                        result: JSON.stringify(logBuffer),
                        logs: JSON.stringify(logBuffer)
                    }
                });

                if (job.config.projectId && job.config.testCaseId) {
                    publishProjectEvent(job.config.projectId, {
                        type: 'test-run-status',
                        testCaseId: job.config.testCaseId,
                        runId,
                        status: 'CANCELLED'
                    });
                }
            } catch (e) {
                logger.error(`Failed to mark ${runId} as cancelled`, e);
            }

        } else {
            const index = this.queue.findIndex(j => j.runId === runId);
            if (index !== -1) {
                const job = this.queue[index];
                this.queue.splice(index, 1);
                prisma.testRun.update({
                    where: { id: runId },
                    data: { status: 'CANCELLED', error: 'Cancelled while queued', completedAt: new Date() }
                }).then(() => {
                    if (job?.config.projectId && job.config.testCaseId) {
                        publishProjectEvent(job.config.projectId, {
                            type: 'test-run-status',
                            testCaseId: job.config.testCaseId,
                            runId,
                            status: 'CANCELLED'
                        });
                    }
                }).catch((error) => logger.error(`Failed to mark ${runId} as cancelled`, error));

                this.logs.delete(runId);
            } else {
                prisma.testRun.findUnique({ where: { id: runId }, select: { status: true } })
                    .then(run => {
                        if (run && ['RUNNING', 'QUEUED'].includes(run.status)) {
                            return prisma.testRun.update({
                                where: { id: runId },
                                data: { status: 'CANCELLED', error: 'Force cancelled (orphaned run)', completedAt: new Date() }
                            });
                        }
                    })
                    .catch(error => logger.error(`Failed to cleanup orphaned run ${runId}`, error));
            }
        }
    }

    public getEvents(runId: string): TestEvent[] {
        return this.logs.get(runId) || [];
    }

    public getStatus(runId: string) {
        if (this.running.has(runId)) return 'RUNNING';
        const inQueue = this.queue.find(j => j.runId === runId);
        if (inQueue) return 'QUEUED';
        return null;
    }

    private async processNext() {
        if (this.running.size >= this.concurrency) return;

        const job = this.queue.shift();
        if (!job) return;

        this.running.set(job.runId, job);

        await prisma.testRun.update({
            where: { id: job.runId },
            data: {
                status: 'RUNNING',
                startedAt: new Date()
            }
        });

        if (job.config.projectId && job.config.testCaseId) {
            publishProjectEvent(job.config.projectId, {
                type: 'test-run-status',
                testCaseId: job.config.testCaseId,
                runId: job.runId,
                status: 'RUNNING'
            });
        }

        this.executeJob(job);

        this.processNext();
    }

    private async executeJob(job: Job) {
        const { runId, config, controller } = job;
        const logBuffer = this.logs.get(runId) || [];
        const userId = config.userId;

        try {
            const result = await runTest({
                runId,
                config,
                signal: controller.signal,
                onEvent: (event) => {
                    logBuffer.push(event);
                },
                onCleanup: (cleanup) => {
                    this.registerCleanup(runId, cleanup);
                }
            });

            await prisma.testRun.update({
                where: { id: runId },
                data: {
                    status: result.status,
                    error: result.error,
                    result: JSON.stringify(logBuffer),
                    logs: JSON.stringify(logBuffer),
                    completedAt: new Date()
                }
            });

            if (config.projectId && config.testCaseId) {
                publishProjectEvent(config.projectId, {
                    type: 'test-run-status',
                    testCaseId: config.testCaseId,
                    runId,
                    status: result.status
                });
            }

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
                        logs: JSON.stringify(logBuffer),
                        completedAt: new Date()
                    }
                });

                if (config.projectId && config.testCaseId) {
                    publishProjectEvent(config.projectId, {
                        type: 'test-run-status',
                        testCaseId: config.testCaseId,
                        runId,
                        status: 'FAIL'
                    });
                }
            }
        } finally {
            this.running.delete(runId);
            this.cleanupFns.delete(runId);
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

import { prisma } from '@/lib/prisma';
import { runTest } from './test-runner';
import { TestEvent, RunTestOptions } from '@/types';
import { config as appConfig } from '@/config/app';
import { QueueError, DatabaseError, getErrorMessage } from './errors';
import { UsageService } from './usage';

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
            console.error(`Failed to update status for ${runId}`, e);
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

            // Force close browser to stop running agent
            const cleanup = this.cleanupFns.get(runId);
            if (cleanup) {
                try {
                    await cleanup();
                } catch (e) {
                    console.error(`Failed to cleanup ${runId}`, e);
                }
                this.cleanupFns.delete(runId);
            }

            this.running.delete(runId);
            // Free up slot immediately for next job
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
            } catch (e) {
                console.error(`Failed to mark ${runId} as cancelled`, e);
            }

        } else {
            const index = this.queue.findIndex(j => j.runId === runId);
            if (index !== -1) {
                this.queue.splice(index, 1);
                prisma.testRun.update({
                    where: { id: runId },
                    data: { status: 'CANCELLED', error: 'Cancelled while queued', completedAt: new Date() }
                }).catch(console.error);

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
                    .catch(e => console.error(`Failed to cleanup orphaned run ${runId}`, e));
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

            console.log(`[Usage] Test completed - runId: ${runId}, userId: ${userId}, actionCount: ${result.actionCount}`);
            if (userId && result.actionCount && result.actionCount > 0) {
                try {
                    const description = await this.buildUsageDescription(runId);
                    console.log(`[Usage] Recording ${result.actionCount} AI actions for: ${description}`);
                    await UsageService.recordUsage(userId, result.actionCount, description, runId);
                    console.log(`[Usage] Successfully recorded usage`);
                } catch (err) {
                    console.error(`[Usage] Failed to record usage:`, err);
                }
            } else {
                console.log(`[Usage] Skipping recording - userId: ${!!userId}, actionCount: ${result.actionCount}`);
            }

        } catch (err) {
            console.error(`Unexpected error in job ${runId}`, err);

            const current = await prisma.testRun.findUnique({ where: { id: runId }, select: { status: true } });
            if (current?.status !== 'CANCELLED') {
                await prisma.testRun.update({
                    where: { id: runId },
                    data: {
                        status: 'FAIL',
                        error: String(err),
                        completedAt: new Date()
                    }
                });
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

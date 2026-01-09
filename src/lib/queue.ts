import { prisma } from '@/lib/prisma';
import { runTest } from './test-runner';
import { TestEvent, RunTestOptions } from '@/types';
import { config as appConfig } from '@/config/app';
import { QueueError, DatabaseError, getErrorMessage } from './errors';

interface Job {
    runId: string;
    config: RunTestOptions['config'];
    controller: AbortController;
}

export class TestQueue {
    private static instance: TestQueue;
    private queue: Job[] = [];
    private running: Map<string, Job> = new Map();
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

    public async cancel(runId: string) {
        if (this.running.has(runId)) {
            const job = this.running.get(runId)!;

            job.controller.abort();
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

        try {
            const result = await runTest({
                runId,
                config,
                signal: controller.signal,
                onEvent: (event) => {
                    logBuffer.push(event);
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
            setTimeout(() => {
                this.logs.delete(runId);
            }, appConfig.queue.logRetentionMs);

            this.processNext();
        }
    }
}

export const queue = TestQueue.getInstance();

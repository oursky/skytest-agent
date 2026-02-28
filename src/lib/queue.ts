import { prisma } from '@/lib/prisma';
import { runTest } from './test-runner';
import { TestEvent, RunTestOptions } from '@/types';
import { config as appConfig } from '@/config/app';
import { getErrorMessage } from './errors';
import { UsageService } from './usage';
import { createLogger } from './logger';
import { publishProjectEvent } from '@/lib/project-events';
import { androidDeviceManager } from './android-device-manager';
import { normalizeAndroidTargetConfig } from './android-target-config';
import type { AndroidDeviceSelector } from '@/types';

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
interface TerminalRunResultOptions {
    status: QueueRunStatus;
    error?: string;
    serializedResult: string;
}

const ACTIVE_RUN_STATUSES = ['QUEUED', 'PREPARING', 'RUNNING'] as const;

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
    private processNextRunning = false;
    private processNextRequested = false;
    private blockedQueueRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingAndroidReservations: Map<string, Array<{ projectId: string; selector: AndroidDeviceSelector; resourceKey: string }>> = new Map();
    private cancellationRequested: Set<string> = new Set();

    private constructor() { }

    public async startup(): Promise<void> {
        try {
            const staleRuns = await prisma.testRun.findMany({
                where: { status: { in: [...ACTIVE_RUN_STATUSES] } },
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
        this.cancellationRequested.delete(runId);

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

        this.triggerProcessNext();
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

    private async persistTerminalRunResult(
        runId: string,
        config: RunTestOptions['config'],
        options: TerminalRunResultOptions
    ): Promise<void> {
        await prisma.testRun.update({
            where: { id: runId },
            data: {
                status: options.status,
                error: options.error,
                result: options.serializedResult,
                logs: null,
                completedAt: new Date()
            }
        });

        await this.updateTestCaseStatus(config.testCaseId, options.status);
        this.publishRunStatus(config.projectId, config.testCaseId, runId, options.status);
    }

    private triggerProcessNext(): void {
        if (this.processNextRunning) {
            this.processNextRequested = true;
            return;
        }
        void this.processNext().catch((error) => {
            logger.error('Failed to advance test queue', error);
        });
    }

    public async cancel(runId: string, errorMessage?: string) {
        this.cancellationRequested.add(runId);

        if (this.running.has(runId)) {
            const job = this.running.get(runId)!;
            let cleanupCompleted = false;

            job.controller.abort();

            const cleanup = this.cleanupFns.get(runId);
            if (cleanup) {
                try {
                    await cleanup();
                    cleanupCompleted = true;
                } catch (e) {
                    logger.error(`Failed to cleanup ${runId}`, e);
                }
                this.cleanupFns.delete(runId);
            }

            const logBuffer = this.logs.get(runId) || [];
            try {
                await this.markRunCancelled(runId, {
                    errorMessage: errorMessage ?? 'Test stopped by user',
                    testCaseId: job.config.testCaseId,
                    projectId: job.config.projectId,
                    resultJson: JSON.stringify(logBuffer),
                    clearLogsField: true,
                });
            } catch (e) {
                logger.error(`Failed to mark ${runId} as cancelled`, e);
            }

            const cancelledEmulatorProfiles = this.getEmulatorProfileNames(job.config);
            if (cancelledEmulatorProfiles.size > 0) {
                await androidDeviceManager.stopIdleEmulatorsForProfiles(cancelledEmulatorProfiles);
            }

            if (cleanupCompleted) {
                this.clearStartedJobState(runId);
                this.triggerProcessNext();
            }

            return;
        } else {
            const index = this.queue.findIndex(j => j.runId === runId);
            if (index !== -1) {
                const job = this.queue[index];
                this.queue.splice(index, 1);

                try {
                    await this.markRunCancelled(runId, {
                        errorMessage: errorMessage ?? 'Cancelled while queued',
                        testCaseId: job.config.testCaseId,
                        projectId: job.config.projectId,
                    });
                } catch (error) {
                    logger.error(`Failed to mark ${runId} as cancelled`, error);
                }

                this.logs.delete(runId);
                this.persistedIndexes.delete(runId);
                this.cancellationRequested.delete(runId);
                this.triggerProcessNext();
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
                            errorMessage: errorMessage ?? 'Force cancelled (orphaned run)',
                            testCaseId: run.testCaseId ?? undefined,
                            projectId: run.testCase?.projectId,
                        });
                    }
                } catch (error) {
                    logger.error(`Failed to cleanup orphaned run ${runId}`, error);
                }
                this.persistedIndexes.delete(runId);
                this.cancellationRequested.delete(runId);
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

    private getStartStatus(): 'PREPARING' {
        return 'PREPARING';
    }

    private getActiveRunCountForProject(projectId: string | undefined): number {
        if (!projectId) {
            return 0;
        }

        let count = 0;
        for (const job of this.running.values()) {
            if (job.config.projectId === projectId) {
                count += 1;
            }
        }
        return count;
    }

    private getAndroidAcquireProbeRequests(
        config: RunTestOptions['config']
    ): Array<{ projectId: string; selector: AndroidDeviceSelector; resourceKey: string }> {
        if (!config.projectId || !config.browserConfig) {
            return [];
        }

        const requests: Array<{ projectId: string; selector: AndroidDeviceSelector; resourceKey: string }> = [];
        for (const target of Object.values(config.browserConfig)) {
            if (!('type' in target) || target.type !== 'android') {
                continue;
            }

            const normalizedTarget = normalizeAndroidTargetConfig(target);
            const selector = normalizedTarget.deviceSelector;
            if (
                (selector.mode === 'emulator-profile' && !selector.emulatorProfileName)
                || (selector.mode === 'connected-device' && !selector.serial)
            ) {
                continue;
            }

            const resourceKey = selector.mode === 'connected-device'
                ? `connected-device:${selector.serial}`
                : `emulator-profile:${selector.emulatorProfileName}`;
            requests.push({
                projectId: config.projectId,
                selector,
                resourceKey,
            });
        }

        return requests;
    }

    private getAllPendingAndroidReservations(): Array<{ projectId: string; selector: AndroidDeviceSelector; resourceKey: string }> {
        const reservations: Array<{ projectId: string; selector: AndroidDeviceSelector; resourceKey: string }> = [];
        for (const requests of this.pendingAndroidReservations.values()) {
            reservations.push(...requests);
        }
        return reservations;
    }

    private clearPendingAndroidReservation(runId: string): void {
        this.pendingAndroidReservations.delete(runId);
    }

    private clearStartedJobState(runId: string): void {
        this.running.delete(runId);
        this.activeStatuses.delete(runId);
        this.clearPendingAndroidReservation(runId);
    }

    private getEmulatorProfileNames(config: RunTestOptions['config']): Set<string> {
        const profileNames = new Set<string>();
        if (!config.browserConfig) {
            return profileNames;
        }

        for (const target of Object.values(config.browserConfig)) {
            if (!('type' in target) || target.type !== 'android') {
                continue;
            }
            const normalizedTarget = normalizeAndroidTargetConfig(target);
            const selector = normalizedTarget.deviceSelector;
            if (selector.mode === 'emulator-profile' && selector.emulatorProfileName) {
                profileNames.add(selector.emulatorProfileName);
            }
        }

        return profileNames;
    }

    private async canStartJobNow(job: Job): Promise<boolean> {
        const perProjectActive = this.getActiveRunCountForProject(job.config.projectId);
        if (perProjectActive >= appConfig.queue.maxConcurrentPerProject) {
            return false;
        }

        const androidRequests = this.getAndroidAcquireProbeRequests(job.config);
        if (androidRequests.length === 0) {
            return true;
        }

        const pendingReservations = this.getAllPendingAndroidReservations();
        return androidDeviceManager.canAcquireBatchImmediately(
            [...pendingReservations, ...androidRequests].map((request) => ({
                projectId: request.projectId,
                selector: request.selector,
            }))
        );
    }

    private async findNextStartableJobRunId(): Promise<string | null> {
        for (const job of this.queue) {
            if (await this.canStartJobNow(job)) {
                return job.runId;
            }
        }

        return null;
    }

    private scheduleBlockedQueueRetry(): void {
        if (this.blockedQueueRetryTimer) {
            return;
        }

        this.blockedQueueRetryTimer = setTimeout(() => {
            this.blockedQueueRetryTimer = null;
            this.triggerProcessNext();
        }, appConfig.queue.pollInterval);
    }

    private clearBlockedQueueRetry(): void {
        if (!this.blockedQueueRetryTimer) {
            return;
        }
        clearTimeout(this.blockedQueueRetryTimer);
        this.blockedQueueRetryTimer = null;
    }

    private async startJob(job: Job): Promise<void> {
        this.running.set(job.runId, job);
        const startStatus = this.getStartStatus();
        this.activeStatuses.set(job.runId, startStatus);
        const androidRequests = this.getAndroidAcquireProbeRequests(job.config);
        if (androidRequests.length > 0) {
            this.pendingAndroidReservations.set(job.runId, androidRequests);
        }

        if (job.controller.signal.aborted || this.cancellationRequested.has(job.runId)) {
            this.clearStartedJobState(job.runId);
            this.cancellationRequested.delete(job.runId);
            this.triggerProcessNext();
            return;
        }

        let shouldExecute = true;

        try {
            const updateResult = await prisma.testRun.updateMany({
                where: {
                    id: job.runId,
                    status: { not: 'CANCELLED' }
                },
                data: {
                    status: startStatus,
                    startedAt: new Date()
                }
            });

            if (updateResult.count === 0 || job.controller.signal.aborted || this.cancellationRequested.has(job.runId)) {
                shouldExecute = false;
            }
            if (shouldExecute) {
                await this.updateTestCaseStatus(job.config.testCaseId, startStatus);
                this.publishRunStatus(job.config.projectId, job.config.testCaseId, job.runId, startStatus);
            }
        } catch (error) {
            logger.error(`Failed to mark job ${job.runId} as ${startStatus}`, error);
        }

        if (!shouldExecute) {
            this.clearStartedJobState(job.runId);
            this.cancellationRequested.delete(job.runId);
            this.triggerProcessNext();
            return;
        }

        void this.executeJob(job).catch((error) => {
            logger.error(`Unhandled queue execution rejection for ${job.runId}`, error);
        });
    }

    private async processNext() {
        if (this.processNextRunning) {
            this.processNextRequested = true;
            return;
        }

        this.processNextRunning = true;

        try {
            do {
                this.processNextRequested = false;

                let startedAny = false;

                while (this.running.size < this.concurrency) {
                    const nextRunId = await this.findNextStartableJobRunId();
                    if (!nextRunId) {
                        break;
                    }

                    const nextIndex = this.queue.findIndex((queuedJob) => queuedJob.runId === nextRunId);
                    if (nextIndex === -1) {
                        continue;
                    }

                    const [job] = this.queue.splice(nextIndex, 1);
                    if (!job) {
                        break;
                    }

                    if (this.cancellationRequested.has(job.runId)) {
                        continue;
                    }

                    this.clearBlockedQueueRetry();
                    await this.startJob(job);
                    startedAny = true;
                }

                if (!startedAny && this.queue.length > 0 && this.running.size < this.concurrency) {
                    this.scheduleBlockedQueueRetry();
                }

                if (this.queue.length === 0) {
                    this.clearBlockedQueueRetry();
                }
            } while (this.processNextRequested);
        } finally {
            this.processNextRunning = false;
            if (this.processNextRequested) {
                this.triggerProcessNext();
            }
        }
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
                    if (controller.signal.aborted || this.cancellationRequested.has(runId) || !this.running.has(runId)) {
                        return;
                    }
                    if (this.activeStatuses.get(runId) === 'PREPARING') {
                        return;
                    }
                    await this.syncActiveRunStatus(runId, config, 'PREPARING');
                },
                onRunning: async () => {
                    if (controller.signal.aborted || this.cancellationRequested.has(runId) || !this.running.has(runId)) {
                        return;
                    }
                    if (this.activeStatuses.get(runId) === 'RUNNING') {
                        return;
                    }
                    this.clearPendingAndroidReservation(runId);
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

            await this.persistTerminalRunResult(runId, config, {
                status: result.status as QueueRunStatus,
                error: result.error,
                serializedResult: JSON.stringify(logBuffer),
            });

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
                await this.persistTerminalRunResult(runId, config, {
                    status: 'FAIL',
                    error: getErrorMessage(err),
                    serializedResult: JSON.stringify(logBuffer),
                });
            }
        } finally {
            this.running.delete(runId);
            this.activeStatuses.delete(runId);
            this.clearPendingAndroidReservation(runId);
            this.cancellationRequested.delete(runId);
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

            this.triggerProcessNext();
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

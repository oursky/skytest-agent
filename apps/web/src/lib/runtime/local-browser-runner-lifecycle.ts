import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { publishRunUpdate } from '@/lib/runners/event-bus';
import { emitRunTerminal } from '@/lib/runners/domain-events';
import { config as appConfig } from '@/config/app';
import { UsageService } from '@/lib/runtime/usage';
import {
    RUN_IN_PROGRESS_STATUSES,
    TEST_STATUS,
    type RunInProgressStatus,
} from '@/types';

export interface LocalBrowserRunOptions {
    runnerId?: string;
}

export interface RunUsageContext {
    actorUserId: string;
    projectId: string;
    description: string;
}

const logger = createLogger('runtime:local-browser-runner-lifecycle');

function triggerQueuedBrowserDispatch(reason: string, runId: string): void {
    void import('@/lib/runtime/browser-run-dispatcher')
        .then(({ dispatchNextQueuedBrowserRun }) => dispatchNextQueuedBrowserRun())
        .catch((error) => {
            logger.warn('Failed to dispatch queued browser run', {
                runId,
                reason,
                error: error instanceof Error ? error.message : String(error),
            });
        });
}

export function createLeaseExpiry(now = new Date()): Date {
    return new Date(now.getTime() + appConfig.runner.leaseDurationSeconds * 1000);
}

export function buildRunOwnershipWhere(runId: string, options?: LocalBrowserRunOptions) {
    const now = new Date();
    return {
        id: runId,
        status: {
            in: [...RUN_IN_PROGRESS_STATUSES],
        },
        ...(options?.runnerId
            ? {
                assignedRunnerId: options.runnerId,
                leaseExpiresAt: { gt: now },
            }
            : {
                assignedRunnerId: null,
            }),
    };
}

export async function runStillActive(runId: string, options?: LocalBrowserRunOptions): Promise<boolean> {
    const run = await prisma.testRun.findFirst({
        where: buildRunOwnershipWhere(runId, options),
        select: { id: true },
    });
    return !!run;
}

export async function updateRunStatusWithOwnership(
    runId: string,
    status: RunInProgressStatus,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const now = new Date();
    const result = await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: {
                in: [...RUN_IN_PROGRESS_STATUSES],
            },
            ...(options?.runnerId
                ? {
                    assignedRunnerId: options.runnerId,
                    leaseExpiresAt: { gt: now },
                }
                : {
                    assignedRunnerId: null,
                }),
        },
        data: {
            status,
            ...(options?.runnerId
                ? {
                    leaseExpiresAt: createLeaseExpiry(now),
                }
                : {}),
        },
    });

    if (result.count > 0) {
        publishRunUpdate(runId);
    }
}

export async function completeRun(
    runId: string,
    testCaseId: string,
    usage: RunUsageContext,
    result?: string,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: buildRunOwnershipWhere(runId, options),
        data: {
            status: TEST_STATUS.PASS,
            result,
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        await prisma.testCase.update({
            where: { id: testCaseId },
            data: { status: TEST_STATUS.PASS },
        });
        try {
            await UsageService.recordRunUsageFromResult({
                actorUserId: usage.actorUserId,
                projectId: usage.projectId,
                result,
                description: usage.description,
                testRunId: runId,
            });
        } catch (error) {
            logger.warn('Failed to record usage for completed run', {
                runId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        publishRunUpdate(runId);
        emitRunTerminal({
            runId,
            status: TEST_STATUS.PASS,
            testCaseId,
            projectId: usage.projectId,
        });
        triggerQueuedBrowserDispatch('complete', runId);
    }
}

export async function failRun(
    runId: string,
    testCaseId: string,
    usage: RunUsageContext,
    error: string,
    result?: string,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: buildRunOwnershipWhere(runId, options),
        data: {
            status: TEST_STATUS.FAIL,
            error,
            result,
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        await prisma.testCase.update({
            where: { id: testCaseId },
            data: { status: TEST_STATUS.FAIL },
        });
        try {
            await UsageService.recordRunUsageFromResult({
                actorUserId: usage.actorUserId,
                projectId: usage.projectId,
                result,
                description: usage.description,
                testRunId: runId,
            });
        } catch (usageError) {
            logger.warn('Failed to record usage for failed run', {
                runId,
                error: usageError instanceof Error ? usageError.message : String(usageError),
            });
        }
        publishRunUpdate(runId);
        emitRunTerminal({
            runId,
            status: TEST_STATUS.FAIL,
            testCaseId,
            projectId: usage.projectId,
        });
        triggerQueuedBrowserDispatch('fail', runId);
    }
}

export async function failRunWithoutTestCase(runId: string, error: string, options?: LocalBrowserRunOptions): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: buildRunOwnershipWhere(runId, options),
        data: {
            status: TEST_STATUS.FAIL,
            error,
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        publishRunUpdate(runId);
        emitRunTerminal({
            runId,
            status: TEST_STATUS.FAIL,
        });
        triggerQueuedBrowserDispatch('fail_without_test_case', runId);
    }
}

export async function cancelRun(
    runId: string,
    testCaseId: string,
    usage: RunUsageContext,
    result?: string,
    options?: LocalBrowserRunOptions
): Promise<void> {
    const now = new Date();
    const updated = await prisma.testRun.updateMany({
        where: buildRunOwnershipWhere(runId, options),
        data: {
            status: TEST_STATUS.CANCELLED,
            error: 'Cancelled by user',
            completedAt: now,
            assignedRunnerId: null,
            leaseExpiresAt: null,
        },
    });

    if (updated.count > 0) {
        await prisma.testCase.update({
            where: { id: testCaseId },
            data: { status: TEST_STATUS.CANCELLED },
        });
        try {
            await UsageService.recordRunUsageFromResult({
                actorUserId: usage.actorUserId,
                projectId: usage.projectId,
                result,
                description: usage.description,
                testRunId: runId,
            });
        } catch (usageError) {
            logger.warn('Failed to record usage for cancelled run', {
                runId,
                error: usageError instanceof Error ? usageError.message : String(usageError),
            });
        }
        publishRunUpdate(runId);
        emitRunTerminal({
            runId,
            status: TEST_STATUS.CANCELLED,
            testCaseId,
            projectId: usage.projectId,
        });
        triggerQueuedBrowserDispatch('cancel', runId);
    }
}

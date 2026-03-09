import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { startLocalBrowserRun } from '@/lib/runtime/local-browser-runner';
import { BROWSER_EXECUTION_CAPABILITY } from '@/lib/runners/constants';

const logger = createLogger('runtime:browser-run-dispatcher');
const LEGACY_BROWSER_RUNNER_KINDS = ['BROWSER_WORKER', 'CONTROL_PLANE'] as const;

export async function dispatchBrowserRun(runId: string): Promise<boolean> {
    const claimed = await prisma.testRun.updateMany({
        where: {
            id: runId,
            status: 'QUEUED',
            deletedAt: null,
            assignedRunnerId: null,
            requiredCapability: BROWSER_EXECUTION_CAPABILITY,
            OR: [
                { requiredRunnerKind: null },
                { requiredRunnerKind: { in: [...LEGACY_BROWSER_RUNNER_KINDS] } },
            ],
        },
        data: {
            status: 'PREPARING',
            startedAt: new Date(),
        },
    });

    if (claimed.count !== 1) {
        return false;
    }

    void startLocalBrowserRun(runId).catch((error) => {
        logger.error('Failed to execute dispatched browser run', {
            runId,
            error: error instanceof Error ? error.message : String(error),
        });
    });

    return true;
}

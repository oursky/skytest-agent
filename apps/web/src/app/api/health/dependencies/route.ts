import { NextResponse } from 'next/server';

import { createLogger } from '@/lib/core/logger';
import { checkObjectStoreHealth } from '@/lib/storage/object-store';

type DependencyCheckStatus = 'ok' | 'error';

interface DependencyCheckResult {
    status: DependencyCheckStatus;
    error?: string;
}

const logger = createLogger('api:health:dependencies');

function getErrorMessage(error: unknown): string {
    logger.warn('Dependency check failed', error);
    return 'Dependency unavailable';
}

async function runCheck(check: () => Promise<void>): Promise<DependencyCheckResult> {
    try {
        await check();
        return { status: 'ok' };
    } catch (error) {
        return {
            status: 'error',
            error: getErrorMessage(error),
        };
    }
}

export async function GET() {
    const storage = await runCheck(checkObjectStoreHealth);
    const status: DependencyCheckStatus = storage.status === 'ok' ? 'ok' : 'error';

    return NextResponse.json(
        {
            status,
            checks: {
                storage,
            },
        },
        { status: status === 'ok' ? 200 : 503 }
    );
}

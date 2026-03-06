import { NextResponse } from 'next/server';

import { checkDatabaseHealth } from '@/lib/core/prisma';
import { checkObjectStoreHealth } from '@/lib/storage/object-store';

type ReadinessCheckStatus = 'ok' | 'error';

interface ReadinessCheckResult {
    status: ReadinessCheckStatus;
    error?: string;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return 'Unknown error';
}

async function runReadinessCheck(check: () => Promise<void>): Promise<ReadinessCheckResult> {
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
    const [database, storage] = await Promise.all([
        runReadinessCheck(checkDatabaseHealth),
        runReadinessCheck(checkObjectStoreHealth),
    ]);

    const status = database.status === 'ok' && storage.status === 'ok' ? 'ok' : 'error';

    return NextResponse.json(
        {
            status,
            checks: {
                database,
                storage,
            },
        },
        { status: status === 'ok' ? 200 : 503 }
    );
}

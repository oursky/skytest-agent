import { NextResponse } from 'next/server';

import { checkObjectStoreHealth } from '@/lib/storage/object-store';

type DependencyCheckStatus = 'ok' | 'error';

interface DependencyCheckResult {
    status: DependencyCheckStatus;
    error?: string;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'Unknown error';
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

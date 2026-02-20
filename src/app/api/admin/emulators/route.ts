import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { emulatorPool } from '@/lib/emulator-pool';
import { createLogger } from '@/lib/logger';
import { config } from '@/config/app';

const logger = createLogger('api:admin:emulators');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!config.features.androidEmulator) {
        return NextResponse.json({ error: 'Android emulator feature not enabled' }, { status: 404 });
    }

    try {
        const status = emulatorPool.getStatus();
        return NextResponse.json(status);
    } catch (error) {
        logger.error('Failed to get emulator pool status', error);
        return NextResponse.json({ error: 'Failed to get pool status' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!config.features.androidEmulator) {
        return NextResponse.json({ error: 'Android emulator feature not enabled' }, { status: 404 });
    }

    try {
        const body = await request.json() as { action: string; emulatorId?: string };
        const { action, emulatorId } = body;

        if (action === 'stop' && emulatorId) {
            await emulatorPool.stop(emulatorId);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error) {
        logger.error('Failed to execute emulator action', error);
        return NextResponse.json({ error: 'Failed to execute action' }, { status: 500 });
    }
}

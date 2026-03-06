import { NextResponse } from 'next/server';
import {
    deviceSyncRequestSchema,
    deviceSyncResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { syncRunnerDevices } from '@/lib/runners/device-sync-service';
import { evaluateRunnerCompatibility } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

const logger = createLogger('api:runners:v1:devices-sync');

export async function POST(request: Request) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-devices-sync-ip');
    if (isRateLimited(ipRateLimitKey, { limit: 240, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-devices-sync-token:${auth.tokenId}`;
    if (isRateLimited(tokenRateLimitKey, { limit: 480, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = deviceSyncRequestSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        const compatibility = evaluateRunnerCompatibility({
            protocolVersion: parsed.data.protocolVersion,
            runnerVersion: parsed.data.runnerVersion,
        });
        if (compatibility.upgradeRequired) {
            return NextResponse.json(
                {
                    error: 'Runner upgrade required',
                    compatibility,
                },
                { status: 426 }
            );
        }

        const synced = await syncRunnerDevices({
            runnerId: auth.runnerId,
            devices: parsed.data.devices,
        });

        const responseBody = deviceSyncResponseSchema.parse({
            runnerId: auth.runnerId,
            syncedAt: synced.syncedAt.toISOString(),
            deviceCount: synced.deviceCount,
            compatibility,
            rotationRequired: auth.rotationRequired,
        });

        return NextResponse.json(responseBody);
    } catch (error) {
        logger.error('Failed to sync runner devices', error);
        return NextResponse.json({ error: 'Failed to sync runner devices' }, { status: 500 });
    }
}

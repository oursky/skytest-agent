import { NextResponse } from 'next/server';
import {
    createPairingTokenResponseSchema,
    RUNNER_MINIMUM_VERSION,
    RUNNER_PROTOCOL_CURRENT_VERSION,
} from '@skytest/runner-protocol';
import { createPairingToken } from '@/lib/runners/credential-service';
import { getRunnerTransportMetadata, evaluateRunnerCompatibility } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';
import { createLogger } from '@/lib/core/logger';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { getTeamAccess } from '@/lib/security/permissions';

const logger = createLogger('api:teams:runner-pairing');

interface PairingTokenBody {
    ttlMinutes?: number;
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const rateLimitKey = getRateLimitKey(request, 'teams-runner-pairing');
    if (isRateLimited(rateLimitKey, { limit: 30, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id: teamId } = await params;
        const access = await getTeamAccess(userId, teamId);
        if (access.role !== 'OWNER' && access.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({})) as PairingTokenBody;
        const created = await createPairingToken({
            teamId,
            createdByUserId: userId,
            ttlMinutes: body.ttlMinutes,
        });

        const responseBody = createPairingTokenResponseSchema.parse({
            token: created.token,
            expiresAt: created.expiresAt.toISOString(),
            compatibility: evaluateRunnerCompatibility({
                protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
                runnerVersion: RUNNER_MINIMUM_VERSION,
            }),
            transport: getRunnerTransportMetadata(),
        });

        return NextResponse.json(responseBody, { status: 201 });
    } catch (error) {
        logger.error('Failed to create runner pairing token', error);
        return NextResponse.json({ error: 'Failed to create runner pairing token' }, { status: 500 });
    }
}

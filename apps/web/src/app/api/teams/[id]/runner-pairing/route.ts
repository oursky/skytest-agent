import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import {
    createPairingTokenResponseSchema,
    RUNNER_MINIMUM_VERSION,
    RUNNER_PROTOCOL_CURRENT_VERSION,
} from '@skytest/runner-protocol';
import { createPairingToken } from '@/lib/runners/credential-service';
import { getRunnerTransportMetadata, evaluateRunnerCompatibility } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';
import { createLogger } from '@/lib/core/logger';
import { getTeamAccess } from '@/lib/security/permissions';
import { guardTeamRouteRequest } from '@/lib/security/team-route-access';

const logger = createLogger('api:teams:runner-pairing');

interface PairingTokenBody {
    ttlMinutes?: number;
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const rateLimitKey = getRateLimitKey(request, 'teams-runner-pairing');
    if (await isRateLimited(rateLimitKey, { limit: 30, windowMs: 60_000 })) {
        return apiError({ status: 429, code: 'RATE_LIMITED', error: 'Too many requests' });
    }

    const guard = await guardTeamRouteRequest({
        request,
        params,
        authorize: async ({ userId, teamId }) => {
            const access = await getTeamAccess(userId, teamId);
            return access.isMember;
        },
    });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { userId, teamId } = guard;

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
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to create runner pairing token' });
    }
}

import { NextResponse } from 'next/server';
import {
    claimJobRequestSchema,
    claimJobResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { claimNextRunForRunner } from '@/lib/runners/claim-service';
import { evaluateRunnerCompatibility } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

const logger = createLogger('api:runners:v1:claim');
const CLAIM_LONG_POLL_TIMEOUT_MS = 15_000;
const CLAIM_RETRY_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export async function POST(request: Request) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-claim-ip');
    if (isRateLimited(ipRateLimitKey, { limit: 240, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-claim-token:${auth.tokenId}`;
    if (isRateLimited(tokenRateLimitKey, { limit: 360, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = claimJobRequestSchema.safeParse(body);
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

        const deadlineMs = Date.now() + CLAIM_LONG_POLL_TIMEOUT_MS;
        let claimed = await claimNextRunForRunner({
            runnerId: auth.runnerId,
            teamId: auth.teamId,
            runnerKind: auth.runnerKind,
            capabilities: auth.capabilities,
        });

        while (!claimed && Date.now() < deadlineMs) {
            await sleep(CLAIM_RETRY_INTERVAL_MS);
            claimed = await claimNextRunForRunner({
                runnerId: auth.runnerId,
                teamId: auth.teamId,
                runnerKind: auth.runnerKind,
                capabilities: auth.capabilities,
            });
        }

        const responseBody = claimJobResponseSchema.parse({
            compatibility,
            rotationRequired: auth.rotationRequired,
            job: claimed
                ? {
                    runId: claimed.runId,
                    testCaseId: claimed.testCaseId,
                    requiredCapability: claimed.requiredCapability,
                    requestedDeviceId: claimed.requestedDeviceId,
                    leaseExpiresAt: claimed.leaseExpiresAt.toISOString(),
                }
                : null,
        });

        return NextResponse.json(responseBody);
    } catch (error) {
        logger.error('Failed to claim run', error);
        return NextResponse.json({ error: 'Failed to claim run' }, { status: 500 });
    }
}

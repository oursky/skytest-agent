import { NextResponse } from 'next/server';
import {
    verifyRunnerCredentialRequestSchema,
    verifyRunnerCredentialResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { evaluateRunnerCompatibility, getRunnerTransportMetadata } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

const logger = createLogger('api:runners:v1:credential:verify');

export async function POST(request: Request) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-credential-verify-ip');
    if (await isRateLimited(ipRateLimitKey, { limit: 240, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-credential-verify-token:${auth.tokenId}`;
    if (await isRateLimited(tokenRateLimitKey, { limit: 360, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = verifyRunnerCredentialRequestSchema.safeParse(body);
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
                    transport: getRunnerTransportMetadata(),
                },
                { status: 426 }
            );
        }

        const responseBody = verifyRunnerCredentialResponseSchema.parse({
            runnerId: auth.runnerId,
            compatibility,
            transport: getRunnerTransportMetadata(),
            credentialExpiresAt: auth.credentialExpiresAt.toISOString(),
            rotationRequired: auth.rotationRequired,
        });
        return NextResponse.json(responseBody);
    } catch (error) {
        logger.error('Failed to verify runner credential', error);
        return NextResponse.json({ error: 'Failed to verify runner credential' }, { status: 500 });
    }
}

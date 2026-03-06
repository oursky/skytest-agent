import { NextResponse } from 'next/server';
import {
    registerRunnerRequestSchema,
    registerRunnerResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { evaluateRunnerCompatibility, getRunnerTransportMetadata } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';
import { registerRunner } from '@/lib/runners/registration-service';

const logger = createLogger('api:runners:v1:register');

export async function POST(request: Request) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-register-ip');
    if (isRateLimited(ipRateLimitKey, { limit: 180, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-register-token:${auth.tokenId}`;
    if (isRateLimited(tokenRateLimitKey, { limit: 240, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = registerRunnerRequestSchema.safeParse(body);
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

        const runner = await registerRunner({
            runnerId: auth.runnerId,
            label: parsed.data.label,
            kind: parsed.data.kind,
            capabilities: parsed.data.capabilities,
            protocolVersion: parsed.data.protocolVersion,
            runnerVersion: parsed.data.runnerVersion,
        });

        const responseBody = registerRunnerResponseSchema.parse({
            runnerId: runner.id,
            compatibility,
            transport: getRunnerTransportMetadata(),
            credentialExpiresAt: auth.credentialExpiresAt.toISOString(),
            rotationRequired: auth.rotationRequired,
        });

        return NextResponse.json(responseBody);
    } catch (error) {
        logger.error('Failed to register runner', error);
        return NextResponse.json({ error: 'Failed to register runner' }, { status: 500 });
    }
}

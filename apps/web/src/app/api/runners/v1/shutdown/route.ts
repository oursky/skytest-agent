import { NextResponse } from 'next/server';
import {
    shutdownRunnerRequestSchema,
    shutdownRunnerResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { evaluateRunnerCompatibility } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';
import { shutdownRunner } from '@/lib/runners/registration-service';

const logger = createLogger('api:runners:v1:shutdown');

export async function POST(request: Request) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-shutdown-ip');
    if (await isRateLimited(ipRateLimitKey, { limit: 240, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-shutdown-token:${auth.tokenId}`;
    if (await isRateLimited(tokenRateLimitKey, { limit: 360, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = shutdownRunnerRequestSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        const compatibility = evaluateRunnerCompatibility({
            protocolVersion: parsed.data.protocolVersion,
            runnerVersion: parsed.data.runnerVersion,
        });

        const runner = await shutdownRunner({
            runnerId: auth.runnerId,
        });

        const responseBody = shutdownRunnerResponseSchema.parse({
            runnerId: runner.id,
            status: 'OFFLINE',
            compatibility,
            rotationRequired: auth.rotationRequired,
        });

        return NextResponse.json(responseBody);
    } catch (error) {
        logger.error('Failed to shutdown runner', error);
        return NextResponse.json({ error: 'Failed to shutdown runner' }, { status: 500 });
    }
}

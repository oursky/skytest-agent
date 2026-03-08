import { NextResponse } from 'next/server';
import {
    completeRunResponseSchema,
    failRunRequestSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { evaluateRunnerCompatibility } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';
import { failOwnedRun } from '@/lib/runners/event-service';

const logger = createLogger('api:runners:v1:job-fail');

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-job-fail-ip');
    if (await isRateLimited(ipRateLimitKey, { limit: 240, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-job-fail-token:${auth.tokenId}`;
    if (await isRateLimited(tokenRateLimitKey, { limit: 360, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = failRunRequestSchema.safeParse(body);
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

        const { id: runId } = await params;
        const failed = await failOwnedRun({
            runId,
            runnerId: auth.runnerId,
            error: parsed.data.error,
            result: parsed.data.result,
        });
        if (!failed) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const responseBody = completeRunResponseSchema.parse({
            runId: failed.runId,
            status: failed.status,
            compatibility,
            rotationRequired: auth.rotationRequired,
        });

        return NextResponse.json(responseBody);
    } catch (error) {
        logger.error('Failed to mark run failed', error);
        return NextResponse.json({ error: 'Failed to mark run failed' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import {
    ingestEventsRequestSchema,
    ingestEventsResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { appendRunEvents } from '@/lib/runners/event-service';
import { evaluateRunnerCompatibility } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

const logger = createLogger('api:runners:v1:job-events');

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-job-events-ip');
    if (await isRateLimited(ipRateLimitKey, { limit: 360, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-job-events-token:${auth.tokenId}`;
    if (await isRateLimited(tokenRateLimitKey, { limit: 900, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = ingestEventsRequestSchema.safeParse(body);
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
        const appended = await appendRunEvents({
            runId,
            runnerId: auth.runnerId,
            events: parsed.data.events,
        });
        if (!appended) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const responseBody = ingestEventsResponseSchema.parse({
            accepted: appended.accepted,
            nextSequence: appended.nextSequence,
            compatibility,
            rotationRequired: auth.rotationRequired,
        });

        return NextResponse.json(responseBody);
    } catch (error) {
        logger.error('Failed to ingest runner events', error);
        return NextResponse.json({ error: 'Failed to ingest runner events' }, { status: 500 });
    }
}

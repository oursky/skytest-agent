import { NextResponse } from 'next/server';
import {
    unpairRunnerRequestSchema,
    unpairRunnerResponseSchema,
} from '@skytest/runner-protocol';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { invalidateTeamAvailabilityCache } from '@/lib/runners/availability-service';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { evaluateRunnerCompatibility } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

const logger = createLogger('api:runners:v1:unpair');

export async function POST(request: Request) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-unpair-ip');
    if (await isRateLimited(ipRateLimitKey, { limit: 120, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-unpair-token:${auth.tokenId}`;
    if (await isRateLimited(tokenRateLimitKey, { limit: 240, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = unpairRunnerRequestSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        const compatibility = evaluateRunnerCompatibility({
            protocolVersion: parsed.data.protocolVersion,
            runnerVersion: parsed.data.runnerVersion,
        });

        const deleted = await prisma.runner.deleteMany({
            where: {
                id: auth.runnerId,
                teamId: auth.teamId,
            },
        });

        if (deleted.count === 0) {
            return NextResponse.json({ error: 'Runner not found' }, { status: 404 });
        }

        invalidateTeamAvailabilityCache(auth.teamId);

        const responseBody = unpairRunnerResponseSchema.parse({
            runnerId: auth.runnerId,
            unpaired: true,
            compatibility,
            rotationRequired: auth.rotationRequired,
        });

        return NextResponse.json(responseBody);
    } catch (error) {
        logger.error('Failed to unpair runner', error);
        return NextResponse.json({ error: 'Failed to unpair runner' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import {
    pairingExchangeRequestSchema,
    pairingExchangeResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { exchangePairingToken } from '@/lib/runners/credential-service';
import { evaluateRunnerCompatibility, getRunnerTransportMetadata } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

const logger = createLogger('api:runners:v1:pairing-exchange');

export async function POST(request: Request) {
    const rateLimitKey = getRateLimitKey(request, 'runners-v1-pairing-exchange');
    if (isRateLimited(rateLimitKey, { limit: 40, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = pairingExchangeRequestSchema.safeParse(body);
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

        const exchanged = await exchangePairingToken(parsed.data);
        if (!exchanged) {
            return NextResponse.json({ error: 'Invalid pairing token' }, { status: 401 });
        }

        const responseBody = pairingExchangeResponseSchema.parse({
            runnerId: exchanged.runnerId,
            runnerToken: exchanged.runnerToken,
            credentialExpiresAt: exchanged.credentialExpiresAt.toISOString(),
            compatibility,
            transport: getRunnerTransportMetadata(),
            rotationRequired: false,
        });

        return NextResponse.json(responseBody, { status: 201 });
    } catch (error) {
        logger.error('Failed to exchange pairing token', error);
        return NextResponse.json({ error: 'Failed to exchange pairing token' }, { status: 500 });
    }
}

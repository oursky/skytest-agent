import { NextResponse } from 'next/server';
import {
    claimJobRequestSchema,
    claimJobResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { claimNextRunForRunner, diagnoseNoClaimForRunner } from '@/lib/runners/claim-service';
import { evaluateRunnerCompatibility, getRunnerTransportMetadata } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';

const logger = createLogger('api:runners:v1:claim');
const shouldCollectClaimDiagnosis = (process.env.LOG_LEVEL ?? 'info').toLowerCase() === 'debug';
const CLAIM_RETRY_INTERVAL_MIN_MS = 250;
const CLAIM_RETRY_INTERVAL_MAX_MS = 5_000;

function parseClaimRetryIntervalMs(fallbackMs: number): number {
    const configured = Number.parseInt(process.env.RUNNER_CLAIM_RETRY_INTERVAL_MS ?? '', 10);
    if (!Number.isFinite(configured) || configured <= 0) {
        return fallbackMs;
    }

    return Math.min(CLAIM_RETRY_INTERVAL_MAX_MS, Math.max(CLAIM_RETRY_INTERVAL_MIN_MS, configured));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export async function POST(request: Request) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-claim-ip');
    if (await isRateLimited(ipRateLimitKey, { limit: 240, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-claim-token:${auth.tokenId}`;
    if (await isRateLimited(tokenRateLimitKey, { limit: 360, windowMs: 60_000 })) {
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

        const transport = getRunnerTransportMetadata();
        const claimLongPollTimeoutMs = transport.claimLongPollTimeoutSeconds * 1000;
        const defaultRetryIntervalMs = Math.max(
            CLAIM_RETRY_INTERVAL_MIN_MS,
            Math.floor(claimLongPollTimeoutMs / 6)
        );
        const configuredRetryIntervalMs = parseClaimRetryIntervalMs(defaultRetryIntervalMs);
        const deadlineMs = Date.now() + claimLongPollTimeoutMs;
        const claimStartedAt = Date.now();
        let retryIntervalMs = configuredRetryIntervalMs;
        let claimed = await claimNextRunForRunner({
            runnerId: auth.runnerId,
            teamId: auth.teamId,
            runnerKind: auth.runnerKind,
            capabilities: auth.capabilities,
        });

        while (!claimed && Date.now() < deadlineMs) {
            await sleep(Math.min(retryIntervalMs, Math.max(0, deadlineMs - Date.now())));
            claimed = await claimNextRunForRunner({
                runnerId: auth.runnerId,
                teamId: auth.teamId,
                runnerKind: auth.runnerKind,
                capabilities: auth.capabilities,
            });
            retryIntervalMs = Math.min(
                CLAIM_RETRY_INTERVAL_MAX_MS,
                Math.floor(retryIntervalMs * 1.5)
            );
        }

        if (claimed) {
            logger.info('Runner claim succeeded', {
                runnerId: auth.runnerId,
                teamId: auth.teamId,
                runId: claimed.runId,
                requestedDeviceId: claimed.requestedDeviceId,
                requestedRunnerId: claimed.requestedRunnerId,
                requiredCapability: claimed.requiredCapability,
                leaseExpiresAt: claimed.leaseExpiresAt.toISOString(),
                elapsedMs: Date.now() - claimStartedAt,
            });
        } else {
            const logMeta: Record<string, unknown> = {
                runnerId: auth.runnerId,
                teamId: auth.teamId,
                elapsedMs: Date.now() - claimStartedAt,
            };

            if (shouldCollectClaimDiagnosis) {
                const diagnosis = await diagnoseNoClaimForRunner({
                    runnerId: auth.runnerId,
                    teamId: auth.teamId,
                    runnerKind: auth.runnerKind,
                    capabilities: auth.capabilities,
                });

                logMeta.reasonCode = diagnosis.reasonCode;
                logMeta.queuedAndroidRuns = diagnosis.queuedAndroidRuns;
                logMeta.queuedCompatibleKindRuns = diagnosis.queuedCompatibleKindRuns;
                logMeta.explicitRequestedRuns = diagnosis.explicitRequestedRuns;
                logMeta.explicitRequestedRunsMatchingRunnerDevices = diagnosis.explicitRequestedRunsMatchingRunnerDevices;
                logMeta.explicitRequestedRunsBlockedByHostLocks = diagnosis.explicitRequestedRunsBlockedByHostLocks;
                logMeta.blockedHostResourceKeys = diagnosis.blockedHostResourceKeys;
                logMeta.genericQueuedRuns = diagnosis.genericQueuedRuns;
                logMeta.claimableDeviceIds = diagnosis.claimableDeviceIds;
            }

            logger.info('Runner claim returned no job', logMeta);
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

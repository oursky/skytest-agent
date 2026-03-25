import { NextResponse } from 'next/server';
import {
    claimJobRequestSchema,
    claimJobResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { parseBoundedIntEnv } from '@/lib/core/env';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { claimNextRunForRunner, diagnoseNoClaimForRunner } from '@/lib/runners/claim-service';
import { evaluateRunnerCompatibility, getRunnerTransportMetadata } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';
import { createRoutePerfTracker, measureJsonBytes } from '@/lib/core/route-perf';

const logger = createLogger('api:runners:v1:claim');
const shouldCollectClaimDiagnosis = (process.env.LOG_LEVEL ?? 'info').toLowerCase() === 'debug';
const CLAIM_RETRY_INTERVAL_MIN_MS = 250;
const CLAIM_RETRY_INTERVAL_MAX_MS = 5_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function applyClaimRetryJitter(baseMs: number): number {
    const jitterSpanMs = Math.max(25, Math.floor(baseMs * 0.2));
    const jitterOffsetMs = Math.floor(Math.random() * (jitterSpanMs * 2 + 1)) - jitterSpanMs;
    return Math.max(CLAIM_RETRY_INTERVAL_MIN_MS, baseMs + jitterOffsetMs);
}

export async function POST(request: Request) {
    const perf = createRoutePerfTracker('/api/runners/v1/jobs/claim', request);
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-claim-ip');
    if (await perf.measureAuth(() => isRateLimited(ipRateLimitKey, { limit: 240, windowMs: 60_000 }))) {
        const body = { error: 'Too many requests' };
        perf.log(logger, { statusCode: 429, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 429 });
    }

    const auth = await perf.measureAuth(() => authenticateRunnerRequest(request));
    if (!auth) {
        const body = { error: 'Unauthorized' };
        perf.log(logger, { statusCode: 401, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-claim-token:${auth.tokenId}`;
    if (await perf.measureAuth(() => isRateLimited(tokenRateLimitKey, { limit: 360, windowMs: 60_000 }))) {
        const body = { error: 'Too many requests' };
        perf.log(logger, { statusCode: 429, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = claimJobRequestSchema.safeParse(body);
        if (!parsed.success) {
            const responseBody = { error: 'Invalid payload' };
            perf.log(logger, { statusCode: 400, responseBytes: measureJsonBytes(responseBody) });
            return NextResponse.json(responseBody, { status: 400 });
        }

        const compatibility = evaluateRunnerCompatibility({
            protocolVersion: parsed.data.protocolVersion,
            runnerVersion: parsed.data.runnerVersion,
        });
        if (compatibility.upgradeRequired) {
            const responseBody = {
                error: 'Runner upgrade required',
                compatibility,
            };
            perf.log(logger, { statusCode: 426, responseBytes: measureJsonBytes(responseBody) });
            return NextResponse.json(responseBody, { status: 426 });
        }

        const transport = getRunnerTransportMetadata();
        const claimLongPollTimeoutMs = transport.claimLongPollTimeoutSeconds * 1000;
        const defaultRetryIntervalMs = Math.max(
            CLAIM_RETRY_INTERVAL_MIN_MS,
            Math.floor(claimLongPollTimeoutMs / 6)
        );
        const configuredRetryIntervalMs = parseBoundedIntEnv({
            name: 'RUNNER_CLAIM_RETRY_INTERVAL_MS',
            fallback: defaultRetryIntervalMs,
            min: CLAIM_RETRY_INTERVAL_MIN_MS,
            max: CLAIM_RETRY_INTERVAL_MAX_MS,
        });
        const deadlineMs = Date.now() + claimLongPollTimeoutMs;
        const claimStartedAt = Date.now();
        let retryIntervalMs = configuredRetryIntervalMs;
        let claimAttempts = 1;
        const claimInput = {
            runnerId: auth.runnerId,
            teamId: auth.teamId,
            runnerKind: auth.runnerKind,
            capabilities: auth.capabilities,
        };
        let claimed = await perf.measureDb(() => claimNextRunForRunner(claimInput));

        while (!claimed && Date.now() < deadlineMs) {
            const jitteredRetryIntervalMs = applyClaimRetryJitter(retryIntervalMs);
            await sleep(Math.min(jitteredRetryIntervalMs, Math.max(0, deadlineMs - Date.now())));
            claimAttempts += 1;
            claimed = await perf.measureDb(() => claimNextRunForRunner(claimInput));
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
                claimAttempts,
            });
        } else {
            const logMeta: Record<string, unknown> = {
                runnerId: auth.runnerId,
                teamId: auth.teamId,
                elapsedMs: Date.now() - claimStartedAt,
                claimAttempts,
            };

            if (shouldCollectClaimDiagnosis) {
                const diagnosis = await perf.measureDb(() => diagnoseNoClaimForRunner(claimInput));

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

        perf.log(logger, { statusCode: 200, responseBytes: measureJsonBytes(responseBody) });
        return NextResponse.json(responseBody);
    } catch (error) {
        logger.error('Failed to claim run', error);
        const body = { error: 'Failed to claim run' };
        perf.log(logger, { statusCode: 500, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 500 });
    }
}

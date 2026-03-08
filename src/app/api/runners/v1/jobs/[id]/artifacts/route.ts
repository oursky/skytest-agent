import { NextResponse } from 'next/server';
import {
    uploadArtifactRequestSchema,
    uploadArtifactResponseSchema,
} from '@skytest/runner-protocol';
import { createLogger } from '@/lib/core/logger';
import { authenticateRunnerRequest } from '@/lib/runners/auth';
import { evaluateRunnerCompatibility } from '@/lib/runners/protocol';
import { getRateLimitKey, isRateLimited } from '@/lib/runners/rate-limit';
import { uploadRunArtifact } from '@/lib/runners/event-service';

const logger = createLogger('api:runners:v1:job-artifacts');

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const ipRateLimitKey = getRateLimitKey(request, 'runners-v1-job-artifacts-ip');
    if (isRateLimited(ipRateLimitKey, { limit: 120, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const auth = await authenticateRunnerRequest(request);
    if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tokenRateLimitKey = `runners-v1-job-artifacts-token:${auth.tokenId}`;
    if (isRateLimited(tokenRateLimitKey, { limit: 240, windowMs: 60_000 })) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    try {
        const body = await request.json();
        const parsed = uploadArtifactRequestSchema.safeParse(body);
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
        const artifact = await uploadRunArtifact({
            runId,
            runnerId: auth.runnerId,
            filename: parsed.data.filename,
            mimeType: parsed.data.mimeType,
            contentBase64: parsed.data.contentBase64,
        });
        if (!artifact) {
            return NextResponse.json({ error: 'Invalid artifact payload or ownership' }, { status: 400 });
        }

        const responseBody = uploadArtifactResponseSchema.parse({
            fileId: artifact.fileId,
            artifactKey: artifact.artifactKey,
            compatibility,
            rotationRequired: auth.rotationRequired,
        });

        return NextResponse.json(responseBody, { status: 201 });
    } catch (error) {
        logger.error('Failed to upload runner artifact', error);
        return NextResponse.json({ error: 'Failed to upload runner artifact' }, { status: 500 });
    }
}

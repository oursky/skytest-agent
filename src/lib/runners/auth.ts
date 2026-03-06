import { prisma } from '@/lib/core/prisma';
import { hashRunnerToken, isRunnerTokenFormat } from '@/lib/runners/credentials';

const CREDENTIAL_ROTATION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface RunnerAuthContext {
    tokenId: string;
    runnerId: string;
    teamId: string;
    credentialExpiresAt: Date;
    rotationRequired: boolean;
}

function getBearerToken(request: Request): string | null {
    const authorization = request.headers.get('Authorization');
    if (!authorization || !authorization.startsWith('Bearer ')) {
        return null;
    }

    const token = authorization.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
}

export async function authenticateRunnerRequest(request: Request): Promise<RunnerAuthContext | null> {
    const rawToken = getBearerToken(request);
    if (!rawToken || !isRunnerTokenFormat(rawToken)) {
        return null;
    }

    const hash = hashRunnerToken(rawToken);
    const now = new Date();

    const token = await prisma.runnerToken.findUnique({
        where: { hash },
        select: {
            id: true,
            teamId: true,
            runnerId: true,
            kind: true,
            revokedAt: true,
            expiresAt: true,
            runner: {
                select: { id: true },
            },
        },
    });

    if (!token) {
        return null;
    }
    if (token.kind !== 'RUNNER') {
        return null;
    }
    if (token.revokedAt) {
        return null;
    }
    if (!token.runnerId || !token.runner) {
        return null;
    }
    if (token.expiresAt.getTime() <= now.getTime()) {
        return null;
    }

    prisma.runnerToken.update({
        where: { id: token.id },
        data: { lastUsedAt: now },
    }).catch(() => {});

    return {
        tokenId: token.id,
        runnerId: token.runnerId,
        teamId: token.teamId,
        credentialExpiresAt: token.expiresAt,
        rotationRequired: token.expiresAt.getTime() - now.getTime() <= CREDENTIAL_ROTATION_THRESHOLD_MS,
    };
}

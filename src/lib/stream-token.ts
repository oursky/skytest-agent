import { SignJWT, jwtVerify, JWTPayload } from 'jose';

export type StreamScope = 'project-events' | 'test-run-events';

interface StreamTokenPayload extends JWTPayload {
    uid: string;
    scope: StreamScope;
    resourceId: string;
}

interface IssueStreamTokenInput {
    userId: string;
    scope: StreamScope;
    resourceId: string;
    expiresInSeconds?: number;
}

interface VerifyStreamTokenInput {
    token: string;
    scope: StreamScope;
    resourceId: string;
}

interface StreamTokenVerificationResult {
    userId: string;
}

const DEFAULT_STREAM_TOKEN_TTL_SECONDS = 60;

function getStreamTokenSecret(): Uint8Array {
    const secret = process.env.STREAM_TOKEN_SECRET || process.env.ENCRYPTION_SECRET;
    if (!secret) {
        throw new Error('STREAM_TOKEN_SECRET or ENCRYPTION_SECRET is required');
    }
    return new TextEncoder().encode(secret);
}

export async function issueStreamToken(input: IssueStreamTokenInput): Promise<string> {
    const ttlSeconds = input.expiresInSeconds ?? DEFAULT_STREAM_TOKEN_TTL_SECONDS;

    return await new SignJWT({
        uid: input.userId,
        scope: input.scope,
        resourceId: input.resourceId
    } satisfies StreamTokenPayload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${ttlSeconds}s`)
        .sign(getStreamTokenSecret());
}

export async function verifyStreamToken(input: VerifyStreamTokenInput): Promise<StreamTokenVerificationResult | null> {
    try {
        const { payload } = await jwtVerify(input.token, getStreamTokenSecret(), {
            algorithms: ['HS256']
        });

        const uid = (payload as { uid?: unknown }).uid;
        const scope = (payload as { scope?: unknown }).scope;
        const resourceId = (payload as { resourceId?: unknown }).resourceId;

        if (typeof uid !== 'string' || uid.length === 0) {
            return null;
        }
        if (scope !== input.scope) {
            return null;
        }
        if (resourceId !== input.resourceId) {
            return null;
        }

        return { userId: uid };
    } catch {
        return null;
    }
}

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth');

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export type AuthPayload = NonNullable<Awaited<ReturnType<typeof verifyAuth>>>;

export async function resolveUserId(authPayload: AuthPayload): Promise<string | null> {
    const maybeUserId = (authPayload as { userId?: unknown }).userId;
    if (typeof maybeUserId === 'string' && maybeUserId.length > 0) {
        return maybeUserId;
    }

    const authId = authPayload.sub as string | undefined;
    if (!authId) return null;
    const user = await prisma.user.findUnique({ where: { authId }, select: { id: true } });
    return user?.id ?? null;
}

function getJwks() {
    if (jwks) return jwks;

    const endpoint = process.env.NEXT_PUBLIC_AUTHGEAR_ENDPOINT;
    if (!endpoint) return null;

    try {
        jwks = createRemoteJWKSet(new URL(`${endpoint}/oauth2/jwks`));
        return jwks;
    } catch {
        return null;
    }
}

export async function verifyAuth(request: Request, token?: string) {
    let finalToken = token;

    if (!finalToken) {
        const authHeader = request.headers.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            finalToken = authHeader.split(' ')[1];
        }
    }

    if (!finalToken) {
        logger.debug('verifyAuth: no token found');
        return null;
    }

    try {
        const jwks = getJwks();
        if (!jwks) {
            logger.error('verifyAuth: Authgear endpoint not configured');
            return null;
        }

        const { payload } = await jwtVerify(finalToken, jwks);
        try {
            const authId = (payload.sub as string | undefined) || undefined;
            if (authId) {
                const user = await prisma.user.findUnique({ where: { authId } });
                if (user) {
                    return { ...payload, userId: user.id } as typeof payload & { userId: string };
                }
            }
        } catch (e) {
            logger.warn('verifyAuth: failed to map auth sub to userId', e);
        }
        return payload;
    } catch (error) {
        logger.error('verifyAuth: token verification failed', error);
        return null;
    }
}

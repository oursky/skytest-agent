import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { hashApiKey, isApiKeyFormat } from '@/lib/api-key';

const logger = createLogger('auth');

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export type AuthPayload = NonNullable<Awaited<ReturnType<typeof verifyAuth>>>;

export async function resolveUserId(authPayload: AuthPayload): Promise<string | null> {
    const maybeUserId = (authPayload as { userId?: unknown }).userId;
    if (typeof maybeUserId === 'string' && maybeUserId.length > 0) {
        const user = await prisma.user.findUnique({
            where: { id: maybeUserId },
            select: { id: true, authId: true }
        });
        if (user && (authPayload.sub === user.authId || authPayload.sub === user.id)) {
            return user.id;
        }
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

export async function verifyAuth(request: Request) {
    let finalToken: string | undefined;

    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        finalToken = authHeader.split(' ')[1];
    }

    if (!finalToken) {
        logger.debug('verifyAuth: no token found');
        return null;
    }

    if (isApiKeyFormat(finalToken)) {
        try {
            const hash = hashApiKey(finalToken);
            const apiKey = await prisma.apiKey.findUnique({
                where: { hash },
                select: { userId: true, id: true }
            });
            if (!apiKey) {
                logger.debug('verifyAuth: API key not found');
                return null;
            }
            prisma.apiKey.update({
                where: { id: apiKey.id },
                data: { lastUsedAt: new Date() }
            }).catch(() => {});
            return { sub: apiKey.userId, userId: apiKey.userId } as { sub: string; userId: string };
        } catch (error) {
            logger.error('verifyAuth: API key verification failed', error);
            return null;
        }
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

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { hashApiKey, isApiKeyFormat } from '@/lib/security/api-key';
import { getAuthgearRuntimeConfig } from '@/lib/security/authgear-config';

const logger = createLogger('auth');

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export type AuthPayload = NonNullable<Awaited<ReturnType<typeof verifyAuth>>>;

function normalizeEmail(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const normalizedEmail = value.trim().toLowerCase();
    return normalizedEmail.length > 0 ? normalizedEmail : null;
}

function isEmailLike(value: string): boolean {
    return value.includes('@');
}

function getPayloadEmail(authPayload: Record<string, unknown>): string | null {
    const email = normalizeEmail(authPayload.email);
    if (email) {
        return email;
    }

    const preferredUsername = normalizeEmail(authPayload.preferred_username);
    if (preferredUsername && isEmailLike(preferredUsername)) {
        return preferredUsername;
    }

    return null;
}

async function fetchUserInfoEmail(accessToken: string): Promise<string | null> {
    const endpoint = getAuthgearRuntimeConfig().endpoint;
    if (!endpoint) {
        return null;
    }

    try {
        const response = await fetch(new URL('/oauth2/userinfo', endpoint), {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            return null;
        }

        const payload = await response.json() as Record<string, unknown>;
        return getPayloadEmail(payload);
    } catch (error) {
        logger.warn('Failed to fetch Authgear user info', error);
        return null;
    }
}

async function syncMembershipEmails(userId: string, email: string) {
    const pendingMemberships = await prisma.teamMembership.findMany({
        where: {
            email,
            userId: null,
        },
        select: {
            id: true,
            teamId: true,
        }
    });

    for (const membership of pendingMemberships) {
        const existingMembership = await prisma.teamMembership.findFirst({
            where: {
                teamId: membership.teamId,
                userId,
            },
            select: { id: true }
        });

        if (existingMembership) {
            await prisma.teamMembership.delete({ where: { id: membership.id } });
            continue;
        }

        try {
            await prisma.teamMembership.update({
                where: { id: membership.id },
                data: {
                    userId,
                    email,
                }
            });
        } catch (error) {
            if (!isUniqueConstraintError(error)) {
                throw error;
            }
        }
    }

    await prisma.teamMembership.updateMany({
        where: { userId },
        data: { email }
    });
}

async function syncUser(authPayload: AuthPayload): Promise<{ id: string; email: string | null } | null> {
    const authSubject = typeof authPayload.sub === 'string' ? authPayload.sub : null;
    const payloadEmail = getPayloadEmail(authPayload as Record<string, unknown>);
    const maybeUserId = (authPayload as { userId?: unknown }).userId;

    if (typeof maybeUserId === 'string' && maybeUserId.length > 0) {
        const user = await prisma.user.findUnique({
            where: { id: maybeUserId },
            select: { id: true, authId: true, email: true }
        });

        if (user && (authSubject === user.authId || authSubject === user.id)) {
            const syncedUser = payloadEmail && authSubject === user.authId && user.email !== payloadEmail
                ? await prisma.user.update({
                    where: { id: user.id },
                    data: { email: payloadEmail },
                    select: { id: true, email: true }
                })
                : { id: user.id, email: user.email };

            if (payloadEmail) {
                await syncMembershipEmails(syncedUser.id, payloadEmail);
                return { id: syncedUser.id, email: payloadEmail };
            }

            return syncedUser;
        }

        if (authSubject === maybeUserId) {
            return null;
        }
    }

    if (!authSubject) {
        return null;
    }

    const user = await prisma.user.upsert({
        where: { authId: authSubject },
        update: payloadEmail ? { email: payloadEmail } : {},
        create: {
            authId: authSubject,
            email: payloadEmail,
        },
        select: { id: true, email: true }
    });

    if (payloadEmail) {
        await syncMembershipEmails(user.id, payloadEmail);
        return { id: user.id, email: payloadEmail };
    }

    return user;
}

export async function resolveUserId(authPayload: AuthPayload): Promise<string | null> {
    const user = await syncUser(authPayload);
    return user?.id ?? null;
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function resolveOrCreateUserId(authPayload: AuthPayload): Promise<string | null> {
    return resolveUserId(authPayload);
}

function getJwks() {
    if (jwks) return jwks;

    const endpoint = getAuthgearRuntimeConfig().endpoint;
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
        const email = getPayloadEmail(payload) ?? await fetchUserInfoEmail(finalToken);
        const enrichedPayload = email ? { ...payload, email } : payload;
        try {
            const authId = (enrichedPayload.sub as string | undefined) || undefined;
            if (authId) {
                const user = await prisma.user.findUnique({ where: { authId } });
                if (user) {
                    return { ...enrichedPayload, userId: user.id } as typeof enrichedPayload & { userId: string };
                }
            }
        } catch (e) {
            logger.warn('verifyAuth: failed to map auth sub to userId', e);
        }
        return enrichedPayload;
    } catch (error) {
        logger.error('verifyAuth: token verification failed', error);
        return null;
    }
}

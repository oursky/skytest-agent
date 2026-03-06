import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId, type AuthPayload } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { isOrganizationMember } from '@/lib/security/permissions';

const logger = createLogger('api:organizations:current');
const CURRENT_ORGANIZATION_COOKIE = 'skytest_current_organization';

async function resolveOrCreateUserId(authPayload: AuthPayload): Promise<string | null> {
    const resolvedUserId = await resolveUserId(authPayload);
    if (resolvedUserId) {
        return resolvedUserId;
    }

    const authId = authPayload.sub as string | undefined;
    if (!authId) {
        return null;
    }

    const user = await prisma.user.upsert({
        where: { authId },
        update: {},
        create: { authId },
        select: { id: true }
    });

    return user.id;
}

async function getDefaultOrganization(userId: string) {
    return prisma.organizationMembership.findFirst({
        where: { userId },
        orderBy: {
            organization: {
                updatedAt: 'desc',
            }
        },
        select: {
            organization: {
                select: {
                    id: true,
                    name: true,
                    createdAt: true,
                    updatedAt: true,
                }
            }
        }
    });
}

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveOrCreateUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const cookieHeader = request.headers.get('cookie') ?? '';
        const cookieValue = cookieHeader
            .split(';')
            .map((item) => item.trim())
            .find((item) => item.startsWith(`${CURRENT_ORGANIZATION_COOKIE}=`))
            ?.split('=')[1];

        if (cookieValue) {
            const organizationId = decodeURIComponent(cookieValue);
            const hasAccess = await isOrganizationMember(userId, organizationId);

            if (hasAccess) {
                const organization = await prisma.organization.findUnique({
                    where: { id: organizationId },
                    select: {
                        id: true,
                        name: true,
                        createdAt: true,
                        updatedAt: true,
                    }
                });

                if (organization) {
                    return NextResponse.json(organization);
                }
            }
        }

        const membership = await getDefaultOrganization(userId);
        if (!membership) {
            return NextResponse.json({ organization: null });
        }

        const response = NextResponse.json(membership.organization);
        response.cookies.set(CURRENT_ORGANIZATION_COOKIE, membership.organization.id, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
        });
        return response;
    } catch (error) {
        logger.error('Failed to resolve current organization', error);
        return NextResponse.json({ error: 'Failed to resolve current team' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveOrCreateUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as { organizationId?: string };
        const organizationId = typeof body.organizationId === 'string' ? body.organizationId.trim() : '';
        if (!organizationId) {
            return NextResponse.json({ error: 'Team is required' }, { status: 400 });
        }

        const hasAccess = await isOrganizationMember(userId, organizationId);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const organization = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        if (!organization) {
            return NextResponse.json({ error: 'Team not found' }, { status: 404 });
        }

        const response = NextResponse.json(organization);
        response.cookies.set(CURRENT_ORGANIZATION_COOKIE, organization.id, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
        });
        return response;
    } catch (error) {
        logger.error('Failed to persist current organization', error);
        return NextResponse.json({ error: 'Failed to persist current team' }, { status: 500 });
    }
}

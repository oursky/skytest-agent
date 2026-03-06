import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canManageTeamMembers, isTeamMember } from '@/lib/security/permissions';

const logger = createLogger('api:teams:members');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        if (!await isTeamMember(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const members = await prisma.teamMembership.findMany({
            where: { teamId: id },
            orderBy: [
                { role: 'asc' },
                { user: { email: 'asc' } },
                { createdAt: 'asc' },
            ],
            select: {
                id: true,
                role: true,
                createdAt: true,
                updatedAt: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                    }
                }
            }
        });

        return NextResponse.json({
            canManageMembers: await canManageTeamMembers(userId, id),
            members: members.map((member) => ({
                id: member.id,
                userId: member.user.id,
                email: member.user.email,
                role: member.role,
                createdAt: member.createdAt,
                updatedAt: member.updatedAt,
            })),
        });
    } catch (error) {
        logger.error('Failed to list team members', error);
        return NextResponse.json({ error: 'Failed to load team members' }, { status: 500 });
    }
}

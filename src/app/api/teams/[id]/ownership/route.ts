import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { canTransferTeamOwnership } from '@/lib/security/permissions';

const logger = createLogger('api:teams:ownership');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

export async function POST(
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
        if (!await canTransferTeamOwnership(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as { email?: string };
        const nextOwnerEmail = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
        if (!nextOwnerEmail) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }
        if (!EMAIL_PATTERN.test(nextOwnerEmail)) {
            return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
        }

        const [currentOwnerMembership, nextOwnerMembership] = await Promise.all([
            prisma.teamMembership.findUnique({
                where: {
                    teamId_userId: {
                        teamId: id,
                        userId,
                    }
                },
                select: { id: true, role: true }
            }),
            prisma.teamMembership.findFirst({
                where: {
                    teamId: id,
                    OR: [
                        { email: nextOwnerEmail },
                        { user: { is: { email: nextOwnerEmail } } },
                    ],
                },
                select: {
                    id: true,
                    role: true,
                    userId: true,
                    email: true,
                    user: {
                        select: {
                            id: true,
                            email: true,
                        }
                    }
                }
            }),
        ]);

        if (!currentOwnerMembership || currentOwnerMembership.role !== 'OWNER') {
            return NextResponse.json({ error: 'Only the current owner can transfer ownership' }, { status: 403 });
        }

        if (!nextOwnerMembership) {
            return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
        }
        if (nextOwnerMembership.role === 'OWNER') {
            return NextResponse.json({ error: 'Choose a different member as the next owner' }, { status: 400 });
        }
        if (!nextOwnerMembership.userId || !nextOwnerMembership.user) {
            return NextResponse.json({ error: 'Team member must join before ownership transfer' }, { status: 400 });
        }

        await prisma.$transaction([
            prisma.teamMembership.update({
                where: { id: currentOwnerMembership.id },
                data: { role: 'MEMBER' },
            }),
            prisma.teamMembership.update({
                where: { id: nextOwnerMembership.id },
                data: { role: 'OWNER' },
            }),
        ]);

        return NextResponse.json({
            success: true,
            owner: {
                userId: nextOwnerMembership.user.id,
                email: nextOwnerMembership.user.email,
            }
        });
    } catch (error) {
        logger.error('Failed to transfer team ownership', error);
        return NextResponse.json({ error: 'Failed to transfer team ownership' }, { status: 500 });
    }
}

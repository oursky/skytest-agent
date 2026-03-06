import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveOrCreateUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';

const logger = createLogger('api:teams');

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveOrCreateUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const teams = await prisma.teamMembership.findMany({
            where: { userId },
            orderBy: {
                team: {
                    updatedAt: 'desc',
                }
            },
            select: {
                role: true,
                team: {
                    select: {
                        id: true,
                        name: true,
                        createdAt: true,
                        updatedAt: true,
                    }
                }
            }
        });

        return NextResponse.json(teams.map((membership) => ({
            ...membership.team,
            role: membership.role,
        })));
    } catch (error) {
        logger.error('Failed to fetch teams', error);
        return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveOrCreateUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const name = typeof body.name === 'string' ? body.name.trim() : '';

        if (!name) {
            return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
        }

        const team = await prisma.team.create({
            data: {
                name,
                memberships: {
                    create: {
                        userId,
                        role: 'OWNER',
                    }
                }
            },
            select: {
                id: true,
                name: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        return NextResponse.json({
            ...team,
            role: 'OWNER',
        }, { status: 201 });
    } catch (error) {
        logger.error('Failed to create team', error);
        return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
    }
}

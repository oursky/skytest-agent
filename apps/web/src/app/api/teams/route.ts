import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { apiError, guardAuthenticatedOrCreateUser } from '@/lib/security/api-route-standards';

const logger = createLogger('api:teams');

export async function GET(request: Request) {
    const guard = await guardAuthenticatedOrCreateUser(request);
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const userId = guard.context.userId;
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
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to fetch teams',
        });
    }
}

export async function POST(request: Request) {
    const guard = await guardAuthenticatedOrCreateUser(request);
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const userId = guard.context.userId;
        const body = await request.json();
        const name = typeof body.name === 'string' ? body.name.trim() : '';

        if (!name) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Team name is required',
            });
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
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to create team',
        });
    }
}

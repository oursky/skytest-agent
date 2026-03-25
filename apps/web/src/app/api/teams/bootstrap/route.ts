import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveOrCreateUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import {
    canDeleteTeam,
    canTransferTeamOwnership,
    isTeamMember,
} from '@/lib/security/permissions';
import { createRoutePerfTracker, measureJsonBytes } from '@/lib/core/route-perf';

const logger = createLogger('api:teams:bootstrap');
const CURRENT_TEAM_COOKIE = 'skytest_current_team';
const isSecureCookie = process.env.NODE_ENV === 'production';

function parseCookieValue(cookieHeader: string, name: string): string | null {
    const encoded = cookieHeader
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${name}=`))
        ?.slice(name.length + 1);

    return encoded ? decodeURIComponent(encoded) : null;
}

export async function GET(request: Request) {
    const perf = createRoutePerfTracker('/api/teams/bootstrap', request);
    const authPayload = await perf.measureAuth(() => verifyAuth(request));
    if (!authPayload) {
        const body = { error: 'Unauthorized' };
        perf.log(logger, { statusCode: 401, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 401 });
    }

    const userId = await perf.measureAuth(() => resolveOrCreateUserId(authPayload));
    if (!userId) {
        const body = { error: 'Unauthorized' };
        perf.log(logger, { statusCode: 401, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 401 });
    }

    try {
        const url = new URL(request.url);
        const requestedTeamId = url.searchParams.get('teamId')?.trim() || null;
        const cookieTeamId = parseCookieValue(request.headers.get('cookie') ?? '', CURRENT_TEAM_COOKIE);

        const memberships = await perf.measureDb(() => prisma.teamMembership.findMany({
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
        }));

        const teams = memberships.map((membership) => ({
            ...membership.team,
            role: membership.role,
        }));

        const selectedTeam = (requestedTeamId
            ? teams.find((team) => team.id === requestedTeamId)
            : null)
            ?? (cookieTeamId ? teams.find((team) => team.id === cookieTeamId) : null)
            ?? teams[0]
            ?? null;

        const selectedTeamId = selectedTeam?.id ?? null;
        let teamDetails: {
            id: string;
            name: string;
            role: 'OWNER' | 'MEMBER';
            canRename: boolean;
            canDelete: boolean;
            canTransferOwnership: boolean;
        } | null = null;
        let members: Array<{
            id: string;
            userId: string | null;
            email: string | null;
            role: 'OWNER' | 'MEMBER';
        }> = [];

        if (selectedTeamId && await perf.measureDb(() => isTeamMember(userId, selectedTeamId))) {
            const [teamMembership, memberRows] = await perf.measureDb(() => Promise.all([
                prisma.teamMembership.findFirst({
                    where: {
                        teamId: selectedTeamId,
                        userId,
                    },
                    select: {
                        role: true,
                        team: {
                            select: {
                                id: true,
                                name: true,
                            }
                        }
                    }
                }),
                prisma.teamMembership.findMany({
                    where: { teamId: selectedTeamId },
                    orderBy: [
                        { role: 'asc' },
                        { email: 'asc' },
                        { createdAt: 'asc' },
                    ],
                    select: {
                        id: true,
                        userId: true,
                        email: true,
                        role: true,
                        user: {
                            select: {
                                email: true,
                            }
                        }
                    }
                }),
            ]));

            if (teamMembership) {
                const role = teamMembership.role;
                const owner = role === 'OWNER';
                const [canDelete, canTransferOwnership] = await perf.measureDb(() => Promise.all([
                    canDeleteTeam(userId, selectedTeamId),
                    canTransferTeamOwnership(userId, selectedTeamId),
                ]));

                teamDetails = {
                    id: teamMembership.team.id,
                    name: teamMembership.team.name,
                    role,
                    canRename: owner,
                    canDelete,
                    canTransferOwnership,
                };
            }

            members = memberRows.map((member) => ({
                id: member.id,
                userId: member.userId,
                email: member.email ?? member.user?.email ?? null,
                role: member.role,
            }));
        }

        const body = {
            teams,
            currentTeam: selectedTeam
                ? {
                    id: selectedTeam.id,
                    name: selectedTeam.name,
                    createdAt: selectedTeam.createdAt,
                    updatedAt: selectedTeam.updatedAt,
                }
                : null,
            teamDetails,
            members,
        };

        const response = NextResponse.json(body);
        if (selectedTeamId && selectedTeamId !== cookieTeamId) {
            response.cookies.set(CURRENT_TEAM_COOKIE, selectedTeamId, {
                httpOnly: true,
                sameSite: 'lax',
                secure: isSecureCookie,
                path: '/',
            });
        }
        perf.log(logger, { statusCode: 200, responseBytes: measureJsonBytes(body) });
        return response;
    } catch (error) {
        logger.error('Failed to resolve teams bootstrap payload', error);
        const body = { error: 'Failed to fetch teams bootstrap payload' };
        perf.log(logger, { statusCode: 500, responseBytes: measureJsonBytes(body) });
        return NextResponse.json(body, { status: 500 });
    }
}

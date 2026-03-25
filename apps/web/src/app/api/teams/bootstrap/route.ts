import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveOrCreateUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import {
    canDeleteTeam,
    canTransferTeamOwnership,
} from '@/lib/security/permissions';
import { createMeasuredJsonResponse, createRoutePerfTracker } from '@/lib/core/route-perf';
import {
    parseCurrentTeamCookie,
    setCurrentTeamCookie,
} from '@/lib/core/current-team-cookie';

const logger = createLogger('api:teams:bootstrap');

export async function GET(request: Request) {
    const perf = createRoutePerfTracker('/api/teams/bootstrap', request);
    const authPayload = await perf.measureAuth(() => verifyAuth(request));
    if (!authPayload) {
        const body = { error: 'Unauthorized' };
        const { response, responseBytes } = createMeasuredJsonResponse(body, { status: 401 });
        perf.log(logger, { statusCode: 401, responseBytes });
        return response;
    }

    const userId = await perf.measureAuth(() => resolveOrCreateUserId(authPayload));
    if (!userId) {
        const body = { error: 'Unauthorized' };
        const { response, responseBytes } = createMeasuredJsonResponse(body, { status: 401 });
        perf.log(logger, { statusCode: 401, responseBytes });
        return response;
    }

    try {
        const url = new URL(request.url);
        const requestedTeamId = url.searchParams.get('teamId')?.trim() || null;
        const cookieTeamId = parseCurrentTeamCookie(request);

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

        if (selectedTeam && selectedTeamId) {
            const memberRows = await perf.measureDb(() => prisma.teamMembership.findMany({
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
            }));
            const role = selectedTeam.role;
            const owner = role === 'OWNER';
            const [canDelete, canTransferOwnership] = await perf.measureDb(() => Promise.all([
                canDeleteTeam(userId, selectedTeamId),
                canTransferTeamOwnership(userId, selectedTeamId),
            ]));

            teamDetails = {
                id: selectedTeam.id,
                name: selectedTeam.name,
                role,
                canRename: owner,
                canDelete,
                canTransferOwnership,
            };

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

        const { response, responseBytes } = createMeasuredJsonResponse(body);
        if (selectedTeamId && selectedTeamId !== cookieTeamId) {
            setCurrentTeamCookie(response, selectedTeamId);
        }
        perf.log(logger, { statusCode: 200, responseBytes });
        return response;
    } catch (error) {
        logger.error('Failed to resolve teams bootstrap payload', error);
        const body = { error: 'Failed to fetch teams bootstrap payload' };
        const { response, responseBytes } = createMeasuredJsonResponse(body, { status: 500 });
        perf.log(logger, { statusCode: 500, responseBytes });
        return response;
    }
}

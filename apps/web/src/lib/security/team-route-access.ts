import { NextResponse } from 'next/server';
import { resolveUserId, verifyAuth } from '@/lib/security/auth';
import { apiError, type ApiErrorResponse } from '@/lib/security/api-route-standards';

export type TeamRouteGuardResult<TParams extends { id: string }> =
    | {
        ok: true;
        params: TParams;
        userId: string;
        teamId: string;
    }
    | {
        ok: false;
        response: NextResponse<ApiErrorResponse>;
    };

export type TeamRouteAuthorizer<TParams extends { id: string }> = (input: {
    userId: string;
    teamId: string;
    params: TParams;
    request: Request;
}) => boolean | Promise<boolean>;

export async function guardTeamRouteRequest<TParams extends { id: string }>(input: {
    request: Request;
    params: Promise<TParams>;
    authorize: TeamRouteAuthorizer<TParams>;
}): Promise<TeamRouteGuardResult<TParams>> {
    const authPayload = await verifyAuth(input.request);
    if (!authPayload) {
        return {
            ok: false,
            response: apiError({
                status: 401,
                code: 'UNAUTHORIZED',
                error: 'Unauthorized',
            }),
        };
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return {
            ok: false,
            response: apiError({
                status: 401,
                code: 'UNAUTHORIZED',
                error: 'Unauthorized',
            }),
        };
    }

    const params = await input.params;
    const teamId = params.id;

    const allowed = await input.authorize({
        userId,
        teamId,
        params,
        request: input.request,
    });
    if (!allowed) {
        return {
            ok: false,
            response: apiError({
                status: 403,
                code: 'FORBIDDEN',
                error: 'Forbidden',
            }),
        };
    }

    return {
        ok: true,
        params,
        userId,
        teamId,
    };
}

import { NextResponse } from 'next/server';
import { resolveOrCreateUserId, resolveUserId, verifyAuth, type AuthPayload } from '@/lib/security/auth';

export type ApiErrorCode =
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'VALIDATION_ERROR'
    | 'CONFLICT'
    | 'RATE_LIMITED'
    | 'INTERNAL_ERROR';

export interface ApiErrorResponse {
    error: string;
    code: ApiErrorCode;
    details?: Record<string, unknown>;
}

export interface ApiSuccessResponse<TData> {
    data: TData;
}

export type ApiResponseBody<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

export interface ApiUserGuardContext {
    authPayload: AuthPayload;
    userId: string;
}

export type ApiUserGuardResult =
    | {
        ok: true;
        context: ApiUserGuardContext;
    }
    | {
        ok: false;
        response: NextResponse<ApiErrorResponse>;
    };

export function apiError(
    input: {
        status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502;
        code: ApiErrorCode;
        error: string;
        details?: Record<string, unknown>;
    }
): NextResponse<ApiErrorResponse> {
    return NextResponse.json(
        {
            error: input.error,
            code: input.code,
            ...(input.details ? { details: input.details } : {}),
        },
        { status: input.status }
    );
}

export function apiOk<TData>(data: TData, status = 200): NextResponse<ApiSuccessResponse<TData>> {
    return NextResponse.json({ data }, { status });
}

export async function guardAuthenticatedUser(request: Request): Promise<ApiUserGuardResult> {
    const authPayload = await verifyAuth(request);
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
                error: 'Invalid auth token',
            }),
        };
    }

    return {
        ok: true,
        context: {
            authPayload,
            userId,
        },
    };
}

export async function guardAuthenticatedOrCreateUser(request: Request): Promise<ApiUserGuardResult> {
    const authPayload = await verifyAuth(request);
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

    const userId = await resolveOrCreateUserId(authPayload);
    if (!userId) {
        return {
            ok: false,
            response: apiError({
                status: 401,
                code: 'UNAUTHORIZED',
                error: 'Invalid auth token',
            }),
        };
    }

    return {
        ok: true,
        context: {
            authPayload,
            userId,
        },
    };
}

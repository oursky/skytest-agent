import type { NextResponse } from 'next/server';

export const CURRENT_TEAM_COOKIE = 'skytest_current_team';

const isSecureCookie = process.env.NODE_ENV === 'production';

function parseCookieValue(cookieHeader: string, name: string): string | null {
    const encoded = cookieHeader
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${name}=`))
        ?.slice(name.length + 1);

    return encoded ? decodeURIComponent(encoded) : null;
}

export function parseCurrentTeamCookie(request: Request): string | null {
    return parseCookieValue(request.headers.get('cookie') ?? '', CURRENT_TEAM_COOKIE);
}

export function setCurrentTeamCookie(response: NextResponse, teamId: string): void {
    response.cookies.set(CURRENT_TEAM_COOKIE, teamId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecureCookie,
        path: '/',
    });
}

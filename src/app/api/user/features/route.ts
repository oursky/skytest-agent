import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { androidEnabled: true },
        });

        return NextResponse.json({
            androidEnabled: user?.androidEnabled ?? false,
        });
    } catch (error) {
        console.error('Failed to fetch user features', error);
        return NextResponse.json({ error: 'Failed to fetch features' }, { status: 500 });
    }
}

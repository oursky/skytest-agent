import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:avd-profiles');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const profiles = await prisma.avdProfile.findMany({
            where: { enabled: true },
            orderBy: { displayName: 'asc' },
        });
        return NextResponse.json(profiles);
    } catch (error) {
        logger.error('Failed to fetch AVD profiles', error);
        return NextResponse.json({ error: 'Failed to fetch AVD profiles' }, { status: 500 });
    }
}

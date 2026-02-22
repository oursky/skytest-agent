import { NextResponse } from 'next/server';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { getUserFeatures } from '@/lib/user-features';

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
        return NextResponse.json(await getUserFeatures(userId));
    } catch (error) {
        console.error('Failed to fetch user features', error);
        return NextResponse.json({ error: 'Failed to fetch features' }, { status: 500 });
    }
}

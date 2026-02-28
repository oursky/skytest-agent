import { NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { getUserFeatures } from '@/lib/user-features';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(getUserFeatures());
}

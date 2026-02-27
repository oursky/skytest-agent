import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:user:api-keys:id');

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const apiKey = await prisma.apiKey.findUnique({ where: { id }, select: { userId: true } });
        if (!apiKey) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        if (apiKey.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        await prisma.apiKey.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to revoke API key', error);
        return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 });
    }
}

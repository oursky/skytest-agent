import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto';

const logger = createLogger('api:user:api-key');

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const resolvedUserId = await resolveUserId(authPayload);
        const user = resolvedUserId
            ? await prisma.user.findUnique({ where: { id: resolvedUserId }, select: { openRouterKey: true } })
            : authPayload.sub
                ? await prisma.user.findUnique({ where: { authId: authPayload.sub as string }, select: { openRouterKey: true } })
                : null;

        if (!user) {
            return NextResponse.json({ hasKey: false, maskedKey: null });
        }

        if (!user.openRouterKey) {
            return NextResponse.json({ hasKey: false, maskedKey: null });
        }

        const decryptedKey = decrypt(user.openRouterKey);
        return NextResponse.json({
            hasKey: true,
            maskedKey: maskApiKey(decryptedKey)
        });
    } catch (error) {
        logger.error('Failed to get API key', error);
        return NextResponse.json({ error: 'Failed to get API key' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { apiKey } = await request.json();

        if (!apiKey || typeof apiKey !== 'string') {
            return NextResponse.json({ error: 'API key is required' }, { status: 400 });
        }

        if (!apiKey.startsWith('sk-')) {
            return NextResponse.json({ error: 'Invalid API key format' }, { status: 400 });
        }

        const encryptedKey = encrypt(apiKey);
        const resolvedUserId = await resolveUserId(authPayload);

        if (resolvedUserId) {
            await prisma.user.update({ where: { id: resolvedUserId }, data: { openRouterKey: encryptedKey } });
        } else {
            const authId = authPayload.sub as string;
            await prisma.user.upsert({
                where: { authId },
                update: { openRouterKey: encryptedKey },
                create: {
                    id: authId,
                    authId,
                    openRouterKey: encryptedKey
                }
            });
        }

        return NextResponse.json({
            success: true,
            maskedKey: maskApiKey(apiKey)
        });
    } catch (error) {
        logger.error('Failed to save API key', error);
        return NextResponse.json({ error: 'Failed to save API key' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const resolvedUserId = await resolveUserId(authPayload);
        if (resolvedUserId) {
            await prisma.user.update({ where: { id: resolvedUserId }, data: { openRouterKey: null } });
        } else {
            await prisma.user.update({
                where: { authId: authPayload.sub as string },
                data: { openRouterKey: null }
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete API key', error);
        return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { encrypt, decrypt, maskApiKey } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload || !authPayload.sub) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = authPayload.sub as string;

    try {
        const user = await prisma.user.findUnique({
            where: { authId: userId },
            select: { openRouterKey: true }
        });

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
        console.error('Failed to get API key:', error);
        return NextResponse.json({ error: 'Failed to get API key' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload || !authPayload.sub) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = authPayload.sub as string;

    try {
        const { apiKey } = await request.json();

        if (!apiKey || typeof apiKey !== 'string') {
            return NextResponse.json({ error: 'API key is required' }, { status: 400 });
        }

        if (!apiKey.startsWith('sk-')) {
            return NextResponse.json({ error: 'Invalid API key format' }, { status: 400 });
        }

        const encryptedKey = encrypt(apiKey);

        await prisma.user.upsert({
            where: { authId: userId },
            update: { openRouterKey: encryptedKey },
            create: {
                id: userId,
                authId: userId,
                openRouterKey: encryptedKey
            }
        });

        return NextResponse.json({
            success: true,
            maskedKey: maskApiKey(apiKey)
        });
    } catch (error) {
        console.error('Failed to save API key:', error);
        return NextResponse.json({ error: 'Failed to save API key' }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload || !authPayload.sub) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = authPayload.sub as string;

    try {
        await prisma.user.update({
            where: { authId: userId },
            data: { openRouterKey: null }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to delete API key:', error);
        return NextResponse.json({ error: 'Failed to delete API key' }, { status: 500 });
    }
}

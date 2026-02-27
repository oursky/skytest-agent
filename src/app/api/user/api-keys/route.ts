import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { generateApiKey } from '@/lib/api-key';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:user:api-keys');

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
        const keys = await prisma.apiKey.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true }
        });
        return NextResponse.json(keys);
    } catch (error) {
        logger.error('Failed to list API keys', error);
        return NextResponse.json({ error: 'Failed to list API keys' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = await resolveUserId(authPayload);
    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { name } = body as { name?: string };
        if (!name || typeof name !== 'string' || !name.trim()) {
            return NextResponse.json({ error: 'Key name is required' }, { status: 400 });
        }

        const { raw, prefix, hash } = generateApiKey();
        const apiKey = await prisma.apiKey.create({
            data: { userId, name: name.trim(), prefix, hash }
        });

        return NextResponse.json({
            id: apiKey.id,
            name: apiKey.name,
            prefix: apiKey.prefix,
            key: raw,
            createdAt: apiKey.createdAt
        });
    } catch (error) {
        logger.error('Failed to generate API key', error);
        return NextResponse.json({ error: 'Failed to generate API key' }, { status: 500 });
    }
}

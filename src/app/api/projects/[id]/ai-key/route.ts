import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { encrypt, decrypt, maskApiKey } from '@/lib/security/crypto';
import { canManageProject, isProjectMember } from '@/lib/security/permissions';

const logger = createLogger('api:projects:ai-key');

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const hasAccess = await isProjectMember(userId, id);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const canEdit = await canManageProject(userId, id);

        const project = await prisma.project.findUnique({
            where: { id },
            select: { openRouterKeyEncrypted: true }
        });

        if (!project || !project.openRouterKeyEncrypted) {
            return NextResponse.json({ hasKey: false, maskedKey: null, canEdit });
        }

        return NextResponse.json({
            hasKey: true,
            maskedKey: maskApiKey(decrypt(project.openRouterKeyEncrypted)),
            canEdit,
        });
    } catch (error) {
        logger.error('Failed to fetch project AI key status', error);
        return NextResponse.json({ error: 'Failed to fetch project AI key status' }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const canEdit = await canManageProject(userId, id);
        if (!canEdit) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { apiKey } = await request.json() as { apiKey?: string };
        if (!apiKey || typeof apiKey !== 'string') {
            return NextResponse.json({ error: 'API key is required' }, { status: 400 });
        }

        if (!apiKey.startsWith('sk-')) {
            return NextResponse.json({ error: 'Invalid API key format' }, { status: 400 });
        }

        await prisma.project.update({
            where: { id },
            data: {
                openRouterKeyEncrypted: encrypt(apiKey),
                openRouterKeyUpdatedAt: new Date(),
            }
        });

        return NextResponse.json({
            success: true,
            maskedKey: maskApiKey(apiKey),
        });
    } catch (error) {
        logger.error('Failed to save project AI key', error);
        return NextResponse.json({ error: 'Failed to save project AI key' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const canEdit = await canManageProject(userId, id);
        if (!canEdit) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await prisma.project.update({
            where: { id },
            data: {
                openRouterKeyEncrypted: null,
                openRouterKeyUpdatedAt: null,
            }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to remove project AI key', error);
        return NextResponse.json({ error: 'Failed to remove project AI key' }, { status: 500 });
    }
}

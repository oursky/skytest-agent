import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { getApkFilePath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import fs from 'fs/promises';

const logger = createLogger('api:projects:apks:delete');

export const dynamic = 'force-dynamic';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; apkId: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id, apkId } = await params;

    try {
        const apk = await prisma.projectApk.findUnique({
            where: { id: apkId },
            include: { project: { select: { userId: true } } }
        });

        if (!apk) {
            return NextResponse.json({ error: 'APK not found' }, { status: 404 });
        }

        if (apk.projectId !== id) {
            return NextResponse.json({ error: 'APK does not belong to this project' }, { status: 400 });
        }

        if (apk.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        await prisma.projectApk.delete({ where: { id: apkId } });

        const filePath = getApkFilePath(id, apk.storedName);
        await fs.unlink(filePath).catch(() => {});

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete APK', error);
        return NextResponse.json({ error: 'Failed to delete APK' }, { status: 500 });
    }
}

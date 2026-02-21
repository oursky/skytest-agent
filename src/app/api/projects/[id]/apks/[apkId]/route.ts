import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { getApkUploadPath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import { ACTIVE_RUN_STATUSES } from '@/utils/statusHelpers';
import fs from 'fs/promises';
import path from 'path';

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

    const userId = await resolveUserId(authPayload);
    if (!userId) {
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

        if (apk.project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const activeRun = await prisma.testRun.findFirst({
            where: {
                status: { in: [...ACTIVE_RUN_STATUSES] },
                configurationSnapshot: { contains: apkId },
            },
            select: { id: true }
        });

        if (activeRun) {
            return NextResponse.json(
                { error: 'Cannot delete APK while it is in use by an active test run.' },
                { status: 409 }
            );
        }

        const filePath = path.join(getApkUploadPath(id), apk.storedName);
        await fs.unlink(filePath).catch(() => {});

        await prisma.projectApk.delete({ where: { id: apkId } });

        logger.info('APK deleted', { apkId, projectId: id, userId });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete APK', error);
        return NextResponse.json({ error: 'Failed to delete APK' }, { status: 500 });
    }
}

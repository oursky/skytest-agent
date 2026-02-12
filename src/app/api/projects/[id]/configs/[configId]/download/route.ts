import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { getProjectConfigUploadPath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('api:projects:config:download');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; configId: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id, configId } = await params;

        const config = await prisma.projectConfig.findUnique({
            where: { id: configId },
            include: { project: { select: { userId: true } } }
        });

        if (!config || config.projectId !== id || config.type !== 'FILE') {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        if (config.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const filePath = path.join(getProjectConfigUploadPath(id), config.value);

        try {
            const buffer = await fs.readFile(filePath);
            return new NextResponse(buffer, {
                headers: {
                    'Content-Type': config.mimeType || 'application/octet-stream',
                    'Content-Disposition': `attachment; filename="${config.filename || config.name}"`,
                    'Content-Length': (config.size || buffer.length).toString(),
                },
            });
        } catch {
            return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
        }
    } catch (error) {
        logger.error('Failed to download config file', error);
        return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
    }
}

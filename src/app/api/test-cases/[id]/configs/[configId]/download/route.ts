import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth } from '@/lib/security/auth';
import { getTestCaseConfigUploadPath } from '@/lib/security/file-security';
import { createLogger } from '@/lib/core/logger';
import { buildContentDisposition } from '@/lib/security/http-headers';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('api:test-cases:config:download');

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

        const config = await prisma.testCaseConfig.findUnique({
            where: { id: configId },
            include: {
                testCase: {
                    include: { project: { select: { userId: true } } }
                }
            }
        });

        if (!config || config.testCaseId !== id || config.type !== 'FILE') {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        if (config.testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const filePath = path.join(getTestCaseConfigUploadPath(id), config.value);

        try {
            const buffer = await fs.readFile(filePath);
            return new NextResponse(buffer, {
                headers: {
                    'Content-Type': config.mimeType || 'application/octet-stream',
                    'Content-Disposition': buildContentDisposition('attachment', config.filename || config.name),
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

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { buildContentDisposition } from '@/lib/security/http-headers';
import { readObjectBuffer } from '@/lib/storage/object-store-utils';
import { isProjectMember } from '@/lib/security/permissions';

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
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const config = await prisma.projectConfig.findUnique({
            where: { id: configId },
            select: {
                id: true,
                projectId: true,
                type: true,
                value: true,
                mimeType: true,
                filename: true,
                name: true,
                size: true,
            }
        });

        if (!config || config.projectId !== id || config.type !== 'FILE') {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        if (!await isProjectMember(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const object = await readObjectBuffer(config.value);
        if (!object) {
            return NextResponse.json({ error: 'File not found in object storage' }, { status: 404 });
        }

        return new NextResponse(new Uint8Array(object.body), {
            headers: {
                'Content-Type': config.mimeType || 'application/octet-stream',
                'Content-Disposition': buildContentDisposition('attachment', config.filename || config.name),
                'Content-Length': (config.size || object.body.length).toString(),
            },
        });
    } catch (error) {
        logger.error('Failed to download config file', error);
        return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { buildContentDisposition } from '@/lib/security/http-headers';
import { readObjectBuffer } from '@/lib/storage/object-store-utils';
import { guardTestCaseRouteRequest } from '@/lib/security/test-case-route-access';

const logger = createLogger('api:test-cases:config:download');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; configId: string }> }
) {
    const guard = await guardTestCaseRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { testCaseId: id, params: { configId } } = guard;

        const config = await prisma.testCaseConfig.findUnique({
            where: { id: configId },
        });

        if (!config || config.testCaseId !== id || config.type !== 'FILE') {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
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

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { createLogger } from '@/lib/core/logger';
import { verifyStreamToken } from '@/lib/security/stream-token';
import { buildContentDisposition } from '@/lib/security/http-headers';
import { deleteObjectIfExists, readObjectBuffer } from '@/lib/storage/object-store-utils';
import { isProjectMember } from '@/lib/security/permissions';

const logger = createLogger('api:test-cases:file');

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string; fileId: string }> }
) {
    const url = new URL(request.url);
    const streamToken = url.searchParams.get('streamToken');
    const authPayload = await verifyAuth(request);
    let userId: string | null = null;
    if (authPayload) {
        userId = await resolveUserId(authPayload);
    }

    const { id, fileId } = await params;

    if (!userId && streamToken) {
        const streamIdentity = await verifyStreamToken({
            token: streamToken,
            scope: 'test-case-files',
            resourceId: id
        });
        userId = streamIdentity?.userId ?? null;
    }

    if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const storedName = url.searchParams.get('storedName');
        const forceInline = url.searchParams.get('inline') === '1';

        let objectKey: string;
        let mimeType: string;
        let filename: string;
        let size: number;

        if (storedName) {
            const testCase = await prisma.testCase.findUnique({
                where: { id },
                select: { id: true, projectId: true }
            });

            if (!testCase) {
                return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
            }

            if (!await isProjectMember(userId, testCase.projectId)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }

            objectKey = storedName;
            const testCaseFile = await prisma.testCaseFile.findFirst({
                where: { testCaseId: id, storedName }
            });
            if (testCaseFile) {
                mimeType = testCaseFile.mimeType;
                filename = testCaseFile.filename;
                size = testCaseFile.size;
            } else {
                const testRunFile = await prisma.testRunFile.findFirst({
                    where: { storedName }
                });
                if (!testRunFile) {
                    return NextResponse.json({ error: 'File not found' }, { status: 404 });
                }
                mimeType = testRunFile.mimeType;
                filename = testRunFile.filename;
                size = testRunFile.size;
            }
        } else {
            const file = await prisma.testCaseFile.findUnique({
                where: { id: fileId },
                include: { testCase: { select: { projectId: true } } }
            });

            if (!file || file.testCaseId !== id) {
                return NextResponse.json({ error: 'File not found' }, { status: 404 });
            }

            if (!await isProjectMember(userId, file.testCase.projectId)) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }

            objectKey = file.storedName;
            mimeType = file.mimeType;
            filename = file.filename;
            size = file.size;
        }

        const object = await readObjectBuffer(objectKey);
        if (!object) {
            return NextResponse.json({ error: 'File not found in object storage' }, { status: 404 });
        }

        const isImage = mimeType.startsWith('image/');
        const dispositionType = (forceInline || isImage) ? 'inline' : 'attachment';
        return new NextResponse(new Uint8Array(object.body), {
            headers: {
                'Content-Type': mimeType,
                'Content-Disposition': buildContentDisposition(dispositionType, filename),
                'Content-Length': size.toString(),
            },
        });
    } catch (error) {
        logger.error('Failed to download file', error);
        return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
    }
}

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string; fileId: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id, fileId } = await params;
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const file = await prisma.testCaseFile.findUnique({
            where: { id: fileId },
            include: { testCase: { select: { projectId: true } } }
        });

        if (!file || file.testCaseId !== id) {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }

        if (!await isProjectMember(userId, file.testCase.projectId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        try {
            await deleteObjectIfExists(file.storedName);
        } catch {
            logger.warn('File not found in object storage', { objectKey: file.storedName });
        }

        await prisma.testCaseFile.delete({
            where: { id: fileId }
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete file', error);
        return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
    }
}

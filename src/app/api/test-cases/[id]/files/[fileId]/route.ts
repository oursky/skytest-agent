import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { getFilePath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import { verifyStreamToken } from '@/lib/stream-token';
import fs from 'fs/promises';

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

        let filePath: string;
        let mimeType: string;
        let filename: string;
        let size: number;

        if (storedName) {
            const testCase = await prisma.testCase.findUnique({
                where: { id },
                include: { project: { select: { userId: true } } }
            });

            if (!testCase) {
                return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
            }

            if (testCase.project.userId !== userId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }

            filePath = getFilePath(id, storedName);
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
                include: {
                    testCase: {
                        include: { project: { select: { userId: true } } }
                    }
                }
            });

            if (!file || file.testCaseId !== id) {
                return NextResponse.json({ error: 'File not found' }, { status: 404 });
            }

            if (file.testCase.project.userId !== userId) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }

            filePath = getFilePath(id, file.storedName);
            mimeType = file.mimeType;
            filename = file.filename;
            size = file.size;
        }

        try {
            const buffer = await fs.readFile(filePath);
            const isImage = mimeType.startsWith('image/');
            const dispositionType = (forceInline || isImage) ? 'inline' : 'attachment';
            return new NextResponse(buffer, {
                headers: {
                    'Content-Type': mimeType,
                    'Content-Disposition': `${dispositionType}; filename="${filename}"`,
                    'Content-Length': size.toString(),
                },
            });
        } catch {
            return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
        }
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

        const file = await prisma.testCaseFile.findUnique({
            where: { id: fileId },
            include: {
                testCase: {
                    include: { project: { select: { userId: true } } }
                }
            }
        });

        if (!file || file.testCaseId !== id) {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
        }

        if (file.testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const filePath = getFilePath(id, file.storedName);

        try {
            await fs.unlink(filePath);
        } catch {
            logger.warn('File not found on disk', { filePath });
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

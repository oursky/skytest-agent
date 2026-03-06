import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth } from '@/lib/security/auth';
import { buildTestCaseFileObjectKey, validateAndSanitizeFile } from '@/lib/security/file-security';
import { createLogger } from '@/lib/core/logger';
import { config } from '@/config/app';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';

const logger = createLogger('api:test-cases:files');

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
        const { id } = await params;

        const testCase = await prisma.testCase.findUnique({
            where: { id },
            include: { project: { select: { userId: true } } }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const dbFiles = await prisma.testCaseFile.findMany({
            where: { testCaseId: id },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json(dbFiles);
    } catch (error) {
        logger.error('Failed to fetch files', error);
        return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
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
        const { id } = await params;

        const testCase = await prisma.testCase.findUnique({
            where: { id },
            include: {
                project: { select: { userId: true } },
                files: { select: { id: true } }
            }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (testCase.files.length >= config.files.maxFilesPerTestCase) {
            return NextResponse.json(
                { error: `Maximum ${config.files.maxFilesPerTestCase} files per test case` },
                { status: 400 }
            );
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const validation = validateAndSanitizeFile(file.name, file.type, file.size);
        if (!validation.valid) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        const extension = validation.sanitizedFilename!.includes('.')
            ? validation.sanitizedFilename!.slice(validation.sanitizedFilename!.lastIndexOf('.'))
            : '';
        const base = extension
            ? validation.sanitizedFilename!.slice(0, -extension.length)
            : validation.sanitizedFilename!;
        let candidateFilename = validation.sanitizedFilename!;
        const existingFiles = await prisma.testCaseFile.findMany({ where: { testCaseId: id } });
        let n = 1;
        const exists = (name: string) => existingFiles.some(f => f.filename === name);
        while (exists(candidateFilename)) {
            candidateFilename = `${base} (${n})${extension}`;
            n += 1;
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const objectKey = buildTestCaseFileObjectKey(id, validation.storedName!);
        await putObjectBuffer({
            key: objectKey,
            body: buffer,
            contentType: file.type,
        });

        const dbFile = await prisma.testCaseFile.create({
            data: {
                testCaseId: id,
                filename: candidateFilename,
                storedName: objectKey,
                mimeType: file.type,
                size: file.size,
            }
        });

        return NextResponse.json(dbFile, { status: 201 });
    } catch (error) {
        logger.error('Failed to upload file', error);
        return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
    }
}

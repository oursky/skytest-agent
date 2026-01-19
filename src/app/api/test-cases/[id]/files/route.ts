import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { validateAndSanitizeFile, getUploadPath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import { config } from '@/config/app';
import fs from 'fs/promises';
import path from 'path';

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

        const ext = path.extname(validation.sanitizedFilename!);
        const base = path.basename(validation.sanitizedFilename!, ext);
        let candidateFilename = validation.sanitizedFilename!;
        const existingFiles = await prisma.testCaseFile.findMany({ where: { testCaseId: id } });
        let n = 1;
        const exists = (name: string) => existingFiles.some(f => f.filename === name);
        while (exists(candidateFilename)) {
            candidateFilename = `${base} (${n})${ext}`;
            n += 1;
        }

        const uploadDir = getUploadPath(id);
        await fs.mkdir(uploadDir, { recursive: true });

        const filePath = path.join(uploadDir, validation.storedName!);
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(filePath, buffer);

        const dbFile = await prisma.testCaseFile.create({
            data: {
                testCaseId: id,
                filename: candidateFilename,
                storedName: validation.storedName!,
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

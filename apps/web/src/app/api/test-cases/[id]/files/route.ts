import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { buildTestCaseFileObjectKey, validateAndSanitizeFile } from '@/lib/security/file-security';
import { createLogger } from '@/lib/core/logger';
import { config } from '@/config/app';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';
import { guardTestCaseRouteRequest } from '@/lib/security/test-case-route-access';

const logger = createLogger('api:test-cases:files');

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTestCaseRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { testCaseId: id } = guard;

        const dbFiles = await prisma.testCaseFile.findMany({
            where: { testCaseId: id },
            orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json(dbFiles);
    } catch (error) {
        logger.error('Failed to fetch files', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to fetch files' });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardTestCaseRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { testCaseId: id } = guard;

        const testCase = await prisma.testCase.findUnique({
            where: { id },
            select: {
                id: true,
                projectId: true,
                files: { select: { id: true } }
            }
        });

        if (!testCase) {
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'Test case not found' });
        }

        if (testCase.files.length >= config.files.maxFilesPerTestCase) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: `Maximum ${config.files.maxFilesPerTestCase} files per test case` });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'No file provided' });
        }

        const validation = validateAndSanitizeFile(file.name, file.type, file.size);
        if (!validation.valid) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: validation.error ?? 'Invalid file' });
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
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to upload file' });
    }
}

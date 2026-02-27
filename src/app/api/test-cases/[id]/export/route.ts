import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { getFilePath, getProjectConfigUploadPath, getTestCaseConfigUploadPath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import { parseTestCaseJson } from '@/lib/test-case-utils';
import { buildContentDisposition } from '@/lib/http-headers';
import { exportToExcelBuffer } from '@/utils/testCaseExcel';
import archiver from 'archiver';
import fs from 'fs/promises';
import path from 'path';
import { PassThrough } from 'stream';

const logger = createLogger('api:test-cases:export');

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
        const xlsxOnly = new URL(request.url).searchParams.get('xlsxOnly') === 'true';

        const testCase = await prisma.testCase.findUnique({
            where: { id },
            include: {
                project: { select: { userId: true } },
                files: true
            }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const projectVariables = await prisma.projectConfig.findMany({
            where: {
                projectId: testCase.projectId,
                type: { in: ['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE'] }
            },
            orderBy: { createdAt: 'asc' }
        });

        const testCaseVariables = await prisma.testCaseConfig.findMany({
            where: {
                testCaseId: testCase.id,
                type: { in: ['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE'] }
            },
            orderBy: { createdAt: 'asc' }
        });

        type ExportableType = 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING' | 'FILE';
        const validTypes = new Set<string>(['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE']);

        const typedProjectVariables: Array<{ name: string; type: ExportableType; value: string; masked: boolean; group: string | null }> = projectVariables.flatMap((variable) => {
            if (!validTypes.has(variable.type)) {
                return [];
            }
            return [{
                name: variable.name,
                type: variable.type as ExportableType,
                value: variable.type === 'FILE' ? (variable.filename || variable.value) : variable.value,
                masked: variable.masked,
                group: variable.group,
            }];
        });

        const typedTestCaseVariables: Array<{ name: string; type: ExportableType; value: string; masked: boolean; group: string | null }> = testCaseVariables.flatMap((variable) => {
            if (!validTypes.has(variable.type)) {
                return [];
            }
            return [{
                name: variable.name,
                type: variable.type as ExportableType,
                value: variable.type === 'FILE' ? (variable.filename || variable.value) : variable.value,
                masked: variable.masked,
                group: variable.group,
            }];
        });

        const parsed = parseTestCaseJson(testCase);
        const excelData = {
            name: parsed.name,
            testCaseId: parsed.displayId || undefined,
            steps: parsed.steps,
            browserConfig: parsed.browserConfig,
            projectVariables: typedProjectVariables,
            testCaseVariables: typedTestCaseVariables,
            files: testCase.files.map((file) => ({
                filename: file.filename,
                mimeType: file.mimeType,
                size: file.size,
            })),
        };

        const excelBuffer = await exportToExcelBuffer(excelData);

        const sanitizeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');
        const sanitizedDisplayId = parsed.displayId ? sanitizeSegment(parsed.displayId) : '';
        const sanitizedName = testCase.name ? sanitizeSegment(testCase.name) : '';
        const excelBasename = sanitizedDisplayId && sanitizedName
            ? `${sanitizedDisplayId}_${sanitizedName}`
            : sanitizedDisplayId || sanitizedName || 'test_case';

        const projectFileVariables = projectVariables.filter((variable) => variable.type === 'FILE');
        const testCaseFileVariables = testCaseVariables.filter((variable) => variable.type === 'FILE');
        const hasAttachedFiles = testCase.files.length > 0 || projectFileVariables.length > 0 || testCaseFileVariables.length > 0;

        if (xlsxOnly || !hasAttachedFiles) {
            return new NextResponse(new Uint8Array(excelBuffer), {
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': buildContentDisposition('attachment', `${excelBasename}.xlsx`),
                    'Content-Length': excelBuffer.length.toString(),
                },
            });
        }

        const archive = archiver('zip', { zlib: { level: 9 } });
        const passthrough = new PassThrough();
        archive.pipe(passthrough);

        archive.append(excelBuffer, { name: `${excelBasename}.xlsx` });
        const usedZipFilenames = new Set<string>();
        const getUniqueZipFilePath = (originalFilename: string): string => {
            const basename = path.basename(originalFilename || 'file');
            const parsed = path.parse(basename);
            const baseName = parsed.name || 'file';
            const ext = parsed.ext || '';
            let nextName = `${baseName}${ext}`;
            let duplicateIndex = 1;

            while (usedZipFilenames.has(nextName.toLowerCase())) {
                nextName = `${baseName}(${duplicateIndex})${ext}`;
                duplicateIndex += 1;
            }

            usedZipFilenames.add(nextName.toLowerCase());
            return `test-files/${nextName}`;
        };

        for (const file of testCase.files) {
            const filePath = getFilePath(id, file.storedName);
            try {
                const fileBuffer = await fs.readFile(filePath);
                archive.append(fileBuffer, { name: getUniqueZipFilePath(file.filename) });
            } catch {
                logger.warn('File not found on disk', { filePath });
            }
        }

        const projectConfigFileDir = getProjectConfigUploadPath(testCase.projectId);
        for (const variable of projectFileVariables) {
            if (!variable.value) {
                continue;
            }
            const filePath = path.join(projectConfigFileDir, variable.value);
            const fileName = variable.filename || variable.value;
            try {
                const fileBuffer = await fs.readFile(filePath);
                archive.append(fileBuffer, { name: getUniqueZipFilePath(fileName) });
            } catch {
                logger.warn('Project config file not found on disk', { filePath });
            }
        }

        const testCaseConfigFileDir = getTestCaseConfigUploadPath(testCase.id);
        for (const variable of testCaseFileVariables) {
            if (!variable.value) {
                continue;
            }
            const filePath = path.join(testCaseConfigFileDir, variable.value);
            const fileName = variable.filename || variable.value;
            try {
                const fileBuffer = await fs.readFile(filePath);
                archive.append(fileBuffer, { name: getUniqueZipFilePath(fileName) });
            } catch {
                logger.warn('Test case config file not found on disk', { filePath });
            }
        }

        await archive.finalize();

        const chunks: Buffer[] = [];
        for await (const chunk of passthrough) {
            chunks.push(chunk as Buffer);
        }
        const zipBuffer = Buffer.concat(chunks);

        return new NextResponse(zipBuffer, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': buildContentDisposition('attachment', `${excelBasename}.zip`),
                'Content-Length': zipBuffer.length.toString(),
            },
        });
    } catch (error) {
        logger.error('Failed to export test case', error);
        return NextResponse.json({ error: 'Failed to export test case' }, { status: 500 });
    }
}

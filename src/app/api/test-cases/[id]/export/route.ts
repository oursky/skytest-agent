import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { getFilePath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import { parseTestCaseJson } from '@/lib/test-case-utils';
import { exportToExcelBuffer } from '@/utils/testCaseExcel';
import archiver from 'archiver';
import fs from 'fs/promises';
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
                type: { in: ['URL', 'VARIABLE', 'SECRET', 'FILE'] }
            },
            orderBy: { createdAt: 'asc' }
        });

        const testCaseVariables = await prisma.testCaseConfig.findMany({
            where: {
                testCaseId: testCase.id,
                type: { in: ['URL', 'VARIABLE', 'SECRET', 'FILE'] }
            },
            orderBy: { createdAt: 'asc' }
        });

        const typedProjectVariables: Array<{ name: string; type: 'URL' | 'VARIABLE' | 'SECRET' | 'FILE'; value: string }> = projectVariables.flatMap((variable) => {
            if (variable.type !== 'URL' && variable.type !== 'VARIABLE' && variable.type !== 'SECRET' && variable.type !== 'FILE') {
                return [];
            }
            return [{
                name: variable.name,
                type: variable.type as 'URL' | 'VARIABLE' | 'SECRET' | 'FILE',
                value: variable.value,
            }];
        });

        const typedTestCaseVariables: Array<{ name: string; type: 'URL' | 'VARIABLE' | 'SECRET' | 'FILE'; value: string }> = testCaseVariables.flatMap((variable) => {
            if (variable.type !== 'URL' && variable.type !== 'VARIABLE' && variable.type !== 'SECRET' && variable.type !== 'FILE') {
                return [];
            }
            return [{
                name: variable.name,
                type: variable.type as 'URL' | 'VARIABLE' | 'SECRET' | 'FILE',
                value: variable.value,
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

        const excelBuffer = exportToExcelBuffer(excelData);

        const sanitizeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');
        const sanitizedDisplayId = parsed.displayId ? sanitizeSegment(parsed.displayId) : '';
        const sanitizedName = testCase.name ? sanitizeSegment(testCase.name) : '';
        const excelBasename = sanitizedDisplayId && sanitizedName
            ? `${sanitizedDisplayId}_${sanitizedName}`
            : sanitizedDisplayId || sanitizedName || 'test_case';

        if (testCase.files.length === 0) {
            return new NextResponse(new Uint8Array(excelBuffer), {
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': `attachment; filename="${excelBasename}.xlsx"`,
                    'Content-Length': excelBuffer.length.toString(),
                },
            });
        }

        const archive = archiver('zip', { zlib: { level: 9 } });
        const passthrough = new PassThrough();
        archive.pipe(passthrough);

        archive.append(excelBuffer, { name: `${excelBasename}.xlsx` });

        for (const file of testCase.files) {
            const filePath = getFilePath(id, file.storedName);
            try {
                const fileBuffer = await fs.readFile(filePath);
                archive.append(fileBuffer, { name: `files/${file.filename}` });
            } catch {
                logger.warn('File not found on disk', { filePath });
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
                'Content-Disposition': `attachment; filename="${excelBasename}.zip"`,
                'Content-Length': zipBuffer.length.toString(),
            },
        });
    } catch (error) {
        logger.error('Failed to export test case', error);
        return NextResponse.json({ error: 'Failed to export test case' }, { status: 500 });
    }
}

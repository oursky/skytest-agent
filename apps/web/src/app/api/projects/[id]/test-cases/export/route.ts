import { NextResponse } from 'next/server';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { isProjectMember } from '@/lib/security/permissions';
import { parseTestCaseJson } from '@/lib/runtime/test-case-utils';
import { buildContentDisposition } from '@/lib/security/http-headers';
import { exportToExcelBuffer } from '@/utils/excel/testCaseExcel';

const logger = createLogger('api:projects:test-cases:export-selected');

type ExportableType = 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING' | 'FILE';
const supportedTypes: ExportableType[] = ['URL', 'APP_ID', 'VARIABLE', 'RANDOM_STRING', 'FILE'];
const supportedTypeSet = new Set<string>(supportedTypes);

function sanitizeSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function formatDateYYYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

function asCsvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

function normalizeFilename(baseName: string, usedNames: Set<string>): string {
    let nextName = `${baseName}.xlsx`;
    let suffix = 1;
    while (usedNames.has(nextName.toLowerCase())) {
        nextName = `${baseName}(${suffix}).xlsx`;
        suffix += 1;
    }
    usedNames.add(nextName.toLowerCase());
    return nextName;
}

function coerceExportType(type: string): ExportableType | null {
    if (!supportedTypeSet.has(type)) {
        return null;
    }
    return type as ExportableType;
}

export const dynamic = 'force-dynamic';

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
        const userId = await resolveUserId(authPayload);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (!await isProjectMember(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json() as { testCaseIds?: string[] };
        const selectedIds = Array.isArray(body.testCaseIds)
            ? [...new Set(body.testCaseIds.map((value) => String(value).trim()).filter(Boolean))]
            : [];
        if (selectedIds.length === 0) {
            return NextResponse.json({ error: 'No test cases selected' }, { status: 400 });
        }

        const selectedOrder = new Map(selectedIds.map((value, index) => [value, index]));
        const testCases = await prisma.testCase.findMany({
            where: {
                projectId: id,
                id: { in: selectedIds },
            },
            include: {
                files: {
                    orderBy: { createdAt: 'asc' },
                },
                testRuns: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    select: { status: true },
                }
            },
        });
        if (testCases.length === 0) {
            return NextResponse.json({ error: 'No matching test cases found' }, { status: 404 });
        }

        const sortedTestCases = [...testCases].sort((a, b) => {
            const rankA = selectedOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
            const rankB = selectedOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
            return rankA - rankB;
        });

        const projectVariables = await prisma.projectConfig.findMany({
            where: {
                projectId: id,
                type: { in: supportedTypes },
            },
            orderBy: { createdAt: 'asc' },
        });

        const csvRows = [
            ['ID', 'Name', 'Status', 'Updated'],
            ...sortedTestCases.map((testCase) => ([
                testCase.displayId || '',
                testCase.name,
                testCase.testRuns[0]?.status || testCase.status || '',
                testCase.updatedAt.toISOString(),
            ]))
        ];
        const csvContent = csvRows
            .map((row) => row.map((cell) => asCsvCell(cell)).join(','))
            .join('\n');
        const projectRecord = await prisma.project.findUnique({
            where: { id },
            select: { name: true },
        });
        const exportFolderName = `${sanitizeSegment(projectRecord?.name || 'project')}_test_cases_${formatDateYYYYMMDD(new Date())}`;

        const archive = archiver('zip', { zlib: { level: 9 } });
        const passthrough = new PassThrough();
        archive.pipe(passthrough);
        archive.append(Buffer.from(csvContent, 'utf8'), { name: `${exportFolderName}/all-test-status.csv` });

        const usedWorkbookNames = new Set<string>();
        for (const testCase of sortedTestCases) {
            const parsedTestCase = parseTestCaseJson(testCase);
            const testCaseVariables = await prisma.testCaseConfig.findMany({
                where: {
                    testCaseId: testCase.id,
                    type: { in: supportedTypes },
                },
                orderBy: { createdAt: 'asc' },
            });

            const excelBuffer = await exportToExcelBuffer({
                name: parsedTestCase.name,
                testCaseId: parsedTestCase.displayId || undefined,
                steps: parsedTestCase.steps,
                browserConfig: parsedTestCase.browserConfig,
                projectVariables: projectVariables.flatMap((config) => {
                    const type = coerceExportType(config.type);
                    if (!type) return [];
                    return [{
                        name: config.name,
                        type,
                        value: type === 'FILE' ? (config.filename || config.value) : config.value,
                        masked: config.masked,
                        group: config.group,
                    }];
                }),
                testCaseVariables: testCaseVariables.flatMap((config) => {
                    const type = coerceExportType(config.type);
                    if (!type) return [];
                    return [{
                        name: config.name,
                        type,
                        value: type === 'FILE' ? (config.filename || config.value) : config.value,
                        masked: config.masked,
                        group: config.group,
                    }];
                }),
                files: testCase.files.map((file) => ({
                    filename: file.filename,
                    mimeType: file.mimeType,
                    size: file.size,
                })),
            });

            const workbookBaseName = `${sanitizeSegment(parsedTestCase.displayId || 'NO_ID')}_${sanitizeSegment(testCase.name || 'test_case')}`;
            const workbookName = normalizeFilename(workbookBaseName, usedWorkbookNames);
            archive.append(excelBuffer, { name: `${exportFolderName}/test-cases/${workbookName}` });
        }

        await archive.finalize();
        const chunks: Buffer[] = [];
        for await (const chunk of passthrough) {
            chunks.push(chunk as Buffer);
        }
        const zipBuffer = Buffer.concat(chunks);
        const zipName = `${exportFolderName}.zip`;

        return new NextResponse(zipBuffer, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': buildContentDisposition('attachment', zipName),
                'Content-Length': String(zipBuffer.length),
            },
        });
    } catch (error) {
        logger.error('Failed to export selected test cases', error);
        return NextResponse.json({ error: 'Failed to export selected test cases' }, { status: 500 });
    }
}

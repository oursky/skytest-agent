import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { parseTestCaseJson } from '@/lib/runtime/test-case-utils';
import { buildContentDisposition } from '@/lib/security/http-headers';
import { readObjectBuffer } from '@/lib/storage/object-store-utils';
import { exportToExcelBuffer } from '@/utils/excel/testCaseExcel';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import type { BrowserConfig } from '@/types';
import path from 'path';

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
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;

        const body = await request.json() as { testCaseIds?: string[] };
        const selectedIds = Array.isArray(body.testCaseIds)
            ? [...new Set(body.testCaseIds.map((value) => String(value).trim()).filter(Boolean))]
            : [];
        if (selectedIds.length === 0) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'No test cases selected' });
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
            return apiError({ status: 404, code: 'NOT_FOUND', error: 'No matching test cases found' });
        }

        const sortedTestCases = [...testCases].sort((a, b) => {
            const rankA = selectedOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
            const rankB = selectedOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
            return rankA - rankB;
        });

        const loginFlowIdSet = new Set<string>();
        for (const testCase of sortedTestCases) {
            const targets = parseTestCaseJson(testCase).browserConfig ?? {};
            for (const targetConfig of Object.values(targets)) {
                const loginFlowId = (targetConfig as BrowserConfig)?.loginFlowId;
                if (typeof loginFlowId === 'string' && loginFlowId.trim()) {
                    loginFlowIdSet.add(loginFlowId.trim());
                }
            }
        }
        const loginFlowDisplayIdById: Record<string, string> = {};
        if (loginFlowIdSet.size > 0) {
            const loginFlowCases = await prisma.testCase.findMany({
                where: { projectId: id, id: { in: [...loginFlowIdSet] } },
                select: { id: true, displayId: true },
            });
            for (const loginFlowCase of loginFlowCases) {
                if (loginFlowCase.displayId) {
                    loginFlowDisplayIdById[loginFlowCase.id] = loginFlowCase.displayId;
                }
            }
        }

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
                kind: testCase.kind,
                url: parsedTestCase.url || undefined,
                prompt: parsedTestCase.prompt || undefined,
                steps: parsedTestCase.steps,
                browserConfig: parsedTestCase.browserConfig,
                loginFlowDisplayIdById,
                projectVariables: projectVariables.flatMap((config) => {
                    const type = coerceExportType(config.type);
                    if (!type) return [];
                    return [{
                        name: config.name,
                        type,
                        value: type === 'FILE' ? (config.filename || config.value) : config.value,
                        masked: config.masked,
                        ...(type === 'FILE' ? { filename: config.filename || undefined, mimeType: config.mimeType || undefined, size: config.size ?? undefined } : {}),
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
                        ...(type === 'FILE' ? { filename: config.filename || undefined, mimeType: config.mimeType || undefined, size: config.size ?? undefined } : {}),
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

            const caseFolder = `${exportFolderName}/test-cases/${workbookName.replace(/\.xlsx$/i, '')}`;
            const usedAssetNames = new Set<string>();
            const uniqueAssetName = (subdir: string, originalFilename: string): string => {
                const parsed = path.parse(path.basename(originalFilename || 'file'));
                const baseName = parsed.name || 'file';
                const ext = parsed.ext || '';
                let nextName = `${baseName}${ext}`;
                let suffix = 1;
                while (usedAssetNames.has(`${subdir}/${nextName.toLowerCase()}`)) {
                    nextName = `${baseName}(${suffix})${ext}`;
                    suffix += 1;
                }
                usedAssetNames.add(`${subdir}/${nextName.toLowerCase()}`);
                return `${caseFolder}/${subdir}/${nextName}`;
            };

            for (const file of testCase.files) {
                const object = await readObjectBuffer(file.storedName);
                if (!object) {
                    logger.warn('Attachment not found in object storage', { objectKey: file.storedName });
                    continue;
                }
                archive.append(object.body, { name: uniqueAssetName('files', file.filename) });
            }

            for (const config of testCaseVariables) {
                if (config.type !== 'FILE' || !config.value) {
                    continue;
                }
                const object = await readObjectBuffer(config.value);
                if (!object) {
                    logger.warn('Test case config file not found in object storage', { objectKey: config.value });
                    continue;
                }
                archive.append(object.body, { name: uniqueAssetName('config-files', config.filename || config.value) });
            }
        }

        const usedProjectFileNames = new Set<string>();
        for (const config of projectVariables) {
            if (config.type !== 'FILE' || !config.value) {
                continue;
            }
            const object = await readObjectBuffer(config.value);
            if (!object) {
                logger.warn('Project config file not found in object storage', { objectKey: config.value });
                continue;
            }
            const parsed = path.parse(path.basename(config.filename || config.value || 'file'));
            const baseName = parsed.name || 'file';
            const ext = parsed.ext || '';
            let nextName = `${baseName}${ext}`;
            let suffix = 1;
            while (usedProjectFileNames.has(nextName.toLowerCase())) {
                nextName = `${baseName}(${suffix})${ext}`;
                suffix += 1;
            }
            usedProjectFileNames.add(nextName.toLowerCase());
            archive.append(object.body, { name: `${exportFolderName}/project-config-files/${nextName}` });
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
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to export selected test cases' });
    }
}

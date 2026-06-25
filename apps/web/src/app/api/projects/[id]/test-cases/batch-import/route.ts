import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { processProjectBatchImport, type BatchImportMode, type BatchImportSourceFile } from '@/lib/test-cases/batch-import-service';
import { readZipEntries, extractTestCaseEntries } from '@/lib/test-cases/import-zip';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';

const logger = createLogger('api:projects:test-cases:batch-import');

export const dynamic = 'force-dynamic';

function resolveMode(modeRaw: FormDataEntryValue | null): BatchImportMode {
    if (modeRaw === 'import-valid') {
        return 'import-valid';
    }
    if (modeRaw === 'import-all-draft') {
        return 'import-all-draft';
    }
    return 'validate';
}

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

        const formData = await request.formData();
        const mode = resolveMode(formData.get('mode'));
        const zip = formData.get('file');
        if (!(zip instanceof File)) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'A .zip file is required' });
        }

        const zipBuffer = Buffer.from(await zip.arrayBuffer());
        let entries;
        try {
            entries = await readZipEntries(zipBuffer);
        } catch (error) {
            logger.warn('Failed to read import zip', error);
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'The uploaded file is not a valid .zip archive' });
        }

        const testCaseEntries = extractTestCaseEntries(entries);
        if (testCaseEntries.length === 0) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'No test case workbooks found in the zip (expected test-cases/*.xlsx)' });
        }

        const importFiles: BatchImportSourceFile[] = testCaseEntries.map((entry) => ({
            filename: `${entry.base}.xlsx`,
            content: entry.xlsx.buffer.slice(
                entry.xlsx.byteOffset,
                entry.xlsx.byteOffset + entry.xlsx.byteLength
            ) as ArrayBuffer,
            attachments: entry.attachments,
        }));

        const result = await processProjectBatchImport({
            projectId: id,
            mode,
            files: importFiles,
        });

        return NextResponse.json(result);
    } catch (error) {
        logger.error('Failed to batch import test cases', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to batch import test cases' });
    }
}

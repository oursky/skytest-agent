import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { createLogger } from '@/lib/core/logger';
import { processProjectBatchImport, type BatchImportMode } from '@/lib/test-cases/batch-import-service';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';

const logger = createLogger('api:projects:test-cases:batch-import');

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

        const formData = await request.formData();
        const modeRaw = formData.get('mode');
        const mode: BatchImportMode = modeRaw === 'import-valid' ? 'import-valid' : 'validate';
        const files = formData.getAll('files').filter((value): value is File => value instanceof File);
        if (files.length === 0) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'No files provided' });
        }

        const importFiles = await Promise.all(files.map(async (file) => ({
            filename: file.name,
            content: await file.arrayBuffer(),
        })));

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

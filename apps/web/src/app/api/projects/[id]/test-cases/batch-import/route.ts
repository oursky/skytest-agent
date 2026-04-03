import { NextResponse } from 'next/server';
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
            return NextResponse.json({ error: 'No files provided' }, { status: 400 });
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
        return NextResponse.json({ error: 'Failed to batch import test cases' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { verifyAuth, resolveUserId } from '@/lib/security/auth';
import { isProjectMember } from '@/lib/security/permissions';
import { processProjectBatchImport, type BatchImportMode } from '@/lib/test-cases/batch-import-service';

const logger = createLogger('api:projects:test-cases:batch-import');

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

        const project = await prisma.project.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }
        if (!await isProjectMember(userId, id)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

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

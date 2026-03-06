import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { verifyAuth } from '@/lib/security/auth';
import { buildTestCaseConfigObjectKey, validateAndSanitizeFile } from '@/lib/security/file-security';
import { validateConfigName, normalizeConfigName } from '@/lib/config/validation';
import { createLogger } from '@/lib/core/logger';
import { normalizeConfigGroup } from '@/lib/config/sort';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';

const logger = createLogger('api:test-cases:configs:upload');

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
            include: { project: { select: { userId: true } } }
        });

        if (!testCase) {
            return NextResponse.json({ error: 'Test case not found' }, { status: 404 });
        }

        if (testCase.project.userId !== authPayload.userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const name = formData.get('name') as string | null;
        const group = formData.get('group') as string | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        if (!name) {
            return NextResponse.json({ error: 'Config name is required' }, { status: 400 });
        }

        const nameError = validateConfigName(name);
        if (nameError) {
            return NextResponse.json({ error: nameError }, { status: 400 });
        }

        const normalizedName = normalizeConfigName(name);
        const normalizedGroup = normalizeConfigGroup(group);

        const validation = validateAndSanitizeFile(file.name, file.type, file.size);
        if (!validation.valid) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        const storedName = validation.storedName!;
        const buffer = Buffer.from(await file.arrayBuffer());
        const objectKey = buildTestCaseConfigObjectKey(id, storedName);
        await putObjectBuffer({
            key: objectKey,
            body: buffer,
            contentType: file.type,
        });

        const config = await prisma.testCaseConfig.create({
            data: {
                testCaseId: id,
                name: normalizedName,
                type: 'FILE',
                value: objectKey,
                masked: false,
                group: normalizedGroup || null,
                filename: validation.sanitizedFilename!,
                mimeType: file.type,
                size: file.size,
            }
        });

        return NextResponse.json(config, { status: 201 });
    } catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && (error as { code: string }).code === 'P2002') {
            return NextResponse.json({ error: 'A config with this name already exists' }, { status: 409 });
        }
        logger.error('Failed to upload config file', error);
        return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/core/prisma';
import { buildTestCaseConfigObjectKey, validateAndSanitizeFile } from '@/lib/security/file-security';
import { validateConfigName, normalizeConfigName } from '@/lib/test-config/validation';
import { createLogger } from '@/lib/core/logger';
import { normalizeConfigGroup } from '@/lib/test-config/sort';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';
import { guardTestCaseRouteRequest } from '@/lib/security/test-case-route-access';

const logger = createLogger('api:test-cases:configs:upload');

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

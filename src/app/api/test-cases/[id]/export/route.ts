import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth } from '@/lib/auth';
import { getFilePath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import { parseTestCaseJson } from '@/lib/test-case-utils';
import { exportToMarkdown } from '@/utils/testCaseMarkdown';
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

        const parsed = parseTestCaseJson(testCase);
        const testData = {
            name: parsed.name,
            url: parsed.url,
            prompt: parsed.prompt || '',
            username: parsed.username || undefined,
            password: '',
            steps: parsed.steps,
            browserConfig: parsed.browserConfig,
        };

        const markdown = exportToMarkdown(testData);

        const archive = archiver('zip', { zlib: { level: 9 } });
        const passthrough = new PassThrough();
        archive.pipe(passthrough);

        archive.append(markdown, { name: 'test-case.md' });

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

        const sanitizedName = testCase.name.replace(/[^a-zA-Z0-9._-]/g, '_');

        return new NextResponse(zipBuffer, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${sanitizedName}.zip"`,
                'Content-Length': zipBuffer.length.toString(),
            },
        });
    } catch (error) {
        logger.error('Failed to export test case', error);
        return NextResponse.json({ error: 'Failed to export test case' }, { status: 500 });
    }
}

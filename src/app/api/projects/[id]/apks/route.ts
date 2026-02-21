import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAuth, resolveUserId } from '@/lib/auth';
import { getApkUploadPath } from '@/lib/file-security';
import { createLogger } from '@/lib/logger';
import { config } from '@/config/app';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';

async function isAndroidEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { androidEnabled: true },
    });
    return user?.androidEnabled ?? false;
}

const logger = createLogger('api:projects:apks');

export const dynamic = 'force-dynamic';

interface ApkMetadata {
    packageName: string;
    activityName: string;
    versionName: string;
}

async function extractApkMetadata(apkPath: string): Promise<ApkMetadata> {
    const androidHome = process.env.ANDROID_HOME ?? '';
    const buildToolsDir = androidHome ? path.join(androidHome, 'build-tools') : '';

    let aapt2Path = 'aapt2';

    if (buildToolsDir) {
        try {
            const versions = await fs.readdir(buildToolsDir);
            const latest = versions.filter(v => !v.startsWith('.')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse()[0];
            if (latest) {
                aapt2Path = path.join(buildToolsDir, latest, 'aapt2');
            }
        } catch (err) {
            // Ignore error and fallback to 'aapt2'
        }
    }

    return new Promise((resolve) => {
        execFile(aapt2Path, ['dump', 'badging', apkPath], { encoding: 'utf8' }, (error, stdout) => {
            if (error || !stdout) {
                logger.warn('aapt2 not available or failed, metadata will be empty', error);
                resolve({ packageName: '', activityName: '', versionName: '' });
                return;
            }

            const packageMatch = stdout.match(/package: name='([^']+)'/);
            const versionMatch = stdout.match(/versionName='([^']+)'/);
            const activityMatch = stdout.match(/launchable-activity: name='([^']+)'/);

            resolve({
                packageName: packageMatch?.[1] ?? '',
                versionName: versionMatch?.[1] ?? '',
                activityName: activityMatch?.[1] ?? '',
            });
        });
    });
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId || !(await isAndroidEnabled(userId))) {
        return NextResponse.json({ error: 'Android testing is not enabled for your account' }, { status: 403 });
    }

    const { id } = await params;

    try {
        const project = await prisma.project.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const apks = await prisma.projectApk.findMany({
            where: { projectId: id },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json(apks);
    } catch (error) {
        logger.error('Failed to fetch APKs', error);
        return NextResponse.json({ error: 'Failed to fetch APKs' }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const authPayload = await verifyAuth(request);
    if (!authPayload) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = await resolveUserId(authPayload);
    if (!userId || !(await isAndroidEnabled(userId))) {
        return NextResponse.json({ error: 'Android testing is not enabled for your account' }, { status: 403 });
    }

    const { id } = await params;

    try {
        const project = await prisma.project.findUnique({
            where: { id },
            include: { apks: { select: { id: true } } }
        });

        if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        if (project.userId !== userId) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (project.apks.length >= config.emulator.apk.maxPerProject) {
            return NextResponse.json(
                { error: `Maximum ${config.emulator.apk.maxPerProject} APKs per project` },
                { status: 400 }
            );
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const ext = path.extname(file.name).toLowerCase();
        if (ext !== '.apk') {
            return NextResponse.json({ error: 'Only .apk files are allowed' }, { status: 400 });
        }

        if (file.size > config.emulator.apk.maxSizeBytes) {
            const maxMB = Math.round(config.emulator.apk.maxSizeBytes / 1024 / 1024);
            return NextResponse.json({ error: `APK exceeds maximum size of ${maxMB}MB` }, { status: 400 });
        }

        const sanitizedFilename = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
        const storedName = `${crypto.randomUUID()}.apk`;

        const uploadDir = getApkUploadPath(id);
        await fs.mkdir(uploadDir, { recursive: true });

        const filePath = path.join(uploadDir, storedName);
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(filePath, buffer);

        const metadata = await extractApkMetadata(filePath);

        const apk = await prisma.projectApk.create({
            data: {
                projectId: id,
                filename: sanitizedFilename,
                storedName,
                packageName: metadata.packageName,
                activityName: metadata.activityName || null,
                versionName: metadata.versionName || null,
                size: file.size,
            }
        });

        return NextResponse.json(apk, { status: 201 });
    } catch (error) {
        logger.error('Failed to upload APK', error);
        return NextResponse.json({ error: 'Failed to upload APK' }, { status: 500 });
    }
}

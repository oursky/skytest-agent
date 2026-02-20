import { config } from '@/config/app';
import path from 'path';
import crypto from 'crypto';

export interface FileValidationResult {
    valid: boolean;
    error?: string;
    sanitizedFilename?: string;
    storedName?: string;
}

export function validateAndSanitizeFile(
    filename: string,
    mimeType: string,
    size: number
): FileValidationResult {
    if (size > config.files.maxFileSize) {
        const maxMB = config.files.maxFileSize / 1024 / 1024;
        return { valid: false, error: `File exceeds maximum size of ${maxMB}MB` };
    }

    if (!config.files.allowedMimeTypes.includes(mimeType)) {
        return { valid: false, error: `File type ${mimeType} is not allowed` };
    }

    const ext = path.extname(filename).toLowerCase();
    if (!config.files.allowedExtensions.includes(ext)) {
        return { valid: false, error: `File extension ${ext} is not allowed` };
    }

    const sanitizedFilename = sanitizeFilename(filename);
    const storedName = `${crypto.randomUUID()}${ext}`;

    return { valid: true, sanitizedFilename, storedName };
}

function sanitizeFilename(filename: string): string {
    const basename = path.basename(filename);
    return basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
}

export function getUploadDir(): string {
    return path.join(process.cwd(), config.files.uploadDir);
}

export function getUploadPath(testCaseId: string): string {
    return path.join(getUploadDir(), testCaseId);
}

export function getFilePath(testCaseId: string, storedName: string): string {
    return path.join(getUploadPath(testCaseId), storedName);
}

export function getProjectConfigUploadPath(projectId: string): string {
    return path.join(getUploadDir(), 'project-configs', projectId);
}

export function getTestCaseConfigUploadPath(testCaseId: string): string {
    return path.join(getUploadDir(), 'testcase-configs', testCaseId);
}

export function getApkUploadPath(projectId: string): string {
    return path.join(process.cwd(), config.emulator.apk.uploadDir, projectId);
}

export function getApkFilePath(projectId: string, storedName: string): string {
    return path.join(getApkUploadPath(projectId), storedName);
}

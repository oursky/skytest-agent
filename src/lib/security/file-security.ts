import { config } from '@/config/app';
import crypto from 'crypto';
import path from 'path';

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
    const storedName = createStoredName(filename);

    return { valid: true, sanitizedFilename, storedName };
}

export function createStoredName(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    return `${crypto.randomUUID()}${ext}`;
}

export function sanitizeFilename(filename: string): string {
    const basename = path.basename(filename);
    return basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
}

export function buildTestCaseFileObjectKey(testCaseId: string, storedName: string): string {
    return `test-cases/${testCaseId}/files/${storedName}`;
}

export function buildProjectConfigObjectKey(projectId: string, storedName: string): string {
    return `projects/${projectId}/configs/${storedName}`;
}

export function buildTestCaseConfigObjectKey(testCaseId: string, storedName: string): string {
    return `test-cases/${testCaseId}/configs/${storedName}`;
}

export function buildRunArtifactObjectKey(runId: string, storedName: string): string {
    return `test-runs/${runId}/artifacts/${storedName}`;
}

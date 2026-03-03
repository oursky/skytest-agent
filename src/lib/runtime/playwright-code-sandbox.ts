import type { Page } from 'playwright';
import path from 'node:path';
import { config } from '@/config/app';
import { PlaywrightCodeError } from '@/lib/core/errors';

type FilePayloadWithPath = Record<string, unknown> & { path: string };

export interface SetInputFilesPolicy {
    allowedFilePaths: ReadonlySet<string>;
    /**
     * Absolute directory for the current test case uploads, e.g. <cwd>/uploads/<testCaseId>.
     * If present, setInputFiles is allowed to reference any file under this directory.
     * If allowedFilePaths is non-empty, the policy is further restricted to that allowlist.
     */
    allowedTestCaseDir?: string;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validatePlaywrightCode(code: string, stepIndex: number): void {
    for (const token of config.test.security.playwrightCodeBlockedTokens) {
        const regex = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
        if (regex.test(code)) {
            throw new PlaywrightCodeError(
                `Unsafe token "${token}" is not allowed in Playwright code`,
                stepIndex,
                code
            );
        }
    }
}

function normalizeUploadPath(filePath: string, policy: SetInputFilesPolicy, stepIndex: number, code: string): string {
    const resolved = path.resolve(process.cwd(), filePath);

    if (policy.allowedTestCaseDir) {
        const testCaseDir = path.resolve(policy.allowedTestCaseDir);
        const prefix = testCaseDir.endsWith(path.sep) ? testCaseDir : `${testCaseDir}${path.sep}`;

        if (!resolved.startsWith(prefix)) {
            throw new PlaywrightCodeError(
                'Only files uploaded for this test case can be used with setInputFiles',
                stepIndex,
                code
            );
        }

        if (policy.allowedFilePaths.size === 0) {
            return resolved;
        }

        if (!policy.allowedFilePaths.has(resolved)) {
            throw new PlaywrightCodeError(
                'Only files attached to this step can be used with setInputFiles',
                stepIndex,
                code
            );
        }

        return resolved;
    }

    const uploadRoot = path.resolve(process.cwd(), config.files.uploadDir);
    const prefix = uploadRoot.endsWith(path.sep) ? uploadRoot : `${uploadRoot}${path.sep}`;

    if (!resolved.startsWith(prefix)) {
        throw new PlaywrightCodeError(
            'Only files uploaded for this test case can be used with setInputFiles',
            stepIndex,
            code
        );
    }

    if (policy.allowedFilePaths.size === 0) {
        throw new PlaywrightCodeError(
            'No files were attached to this step. Attach files to the step before calling setInputFiles.',
            stepIndex,
            code
        );
    }

    if (!policy.allowedFilePaths.has(resolved)) {
        throw new PlaywrightCodeError(
            'Only files attached to this step can be used with setInputFiles',
            stepIndex,
            code
        );
    }

    return resolved;
}

function hasFilePath(value: unknown): value is FilePayloadWithPath {
    if (!value || typeof value !== 'object') return false;
    if (!('path' in value)) return false;
    const pathValue = (value as { path?: unknown }).path;
    return typeof pathValue === 'string' && pathValue.length > 0;
}

function sanitizeInputFiles(files: unknown, policy: SetInputFilesPolicy, stepIndex: number, code: string): unknown {
    if (typeof files === 'string') {
        return normalizeUploadPath(files, policy, stepIndex, code);
    }

    if (Array.isArray(files)) {
        return files.map((file) => {
            if (typeof file === 'string') {
                return normalizeUploadPath(file, policy, stepIndex, code);
            }
            if (hasFilePath(file)) {
                return { ...file, path: normalizeUploadPath(file.path, policy, stepIndex, code) };
            }
            return file;
        });
    }

    if (hasFilePath(files)) {
        return { ...files, path: normalizeUploadPath(files.path, policy, stepIndex, code) };
    }

    return files;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
    return 'then' in value && typeof (value as { then?: unknown }).then === 'function';
}

function hasSetInputFilesMethod(
    value: unknown
): value is Record<string, unknown> & { setInputFiles: (...args: unknown[]) => unknown } {
    if (!value || typeof value !== 'object') return false;
    if (!('setInputFiles' in value)) return false;
    return typeof (value as { setInputFiles?: unknown }).setInputFiles === 'function';
}

export function createSafePage(page: Page, stepIndex: number, code: string, policy: SetInputFilesPolicy): Page {
    const proxyCache = new WeakMap<object, object>();

    const sanitizeSetInputFilesArgs = (args: unknown[]): unknown[] => {
        if (args.length === 0) return args;

        if (typeof args[0] === 'string' && args.length >= 2) {
            const [selector, files, ...rest] = args;
            return [selector, sanitizeInputFiles(files, policy, stepIndex, code), ...rest];
        }

        const [files, ...rest] = args;
        return [sanitizeInputFiles(files, policy, stepIndex, code), ...rest];
    };

    const wrapValue = (value: unknown): unknown => {
        if (isThenable(value)) {
            return (value as PromiseLike<unknown>).then((resolved) => wrapValue(resolved));
        }

        if (Array.isArray(value)) {
            return value.map((item) => wrapValue(item));
        }

        if (hasSetInputFilesMethod(value)) {
            return wrapObject(value);
        }

        return value;
    };

    const wrapObject = <T extends object>(target: T): T => {
        const cached = proxyCache.get(target);
        if (cached) return cached as T;

        const proxy = new Proxy(target, {
            get(objTarget, prop) {
                if (prop === 'setInputFiles') {
                    const original = Reflect.get(objTarget, prop) as unknown;
                    if (typeof original !== 'function') return original;

                    return async (...args: unknown[]) => {
                        const sanitizedArgs = sanitizeSetInputFilesArgs(args);
                        return (original as (...args: unknown[]) => unknown).apply(objTarget, sanitizedArgs);
                    };
                }

                const value = Reflect.get(objTarget, prop) as unknown;
                if (typeof value === 'function') {
                    const propName = typeof prop === 'string' ? prop : '';
                    if (propName === 'constructor') {
                        return value;
                    }
                    if (propName.startsWith('_')) {
                        return (value as (...args: unknown[]) => unknown).bind(objTarget);
                    }

                    return (...args: unknown[]) => {
                        const result = (value as (...args: unknown[]) => unknown).apply(objTarget, args);
                        return wrapValue(result);
                    };
                }

                return value;
            }
        });

        proxyCache.set(target, proxy);
        return proxy as T;
    };

    return wrapObject(page);
}

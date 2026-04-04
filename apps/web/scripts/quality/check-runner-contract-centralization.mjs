#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const repoRoot = path.resolve(workspaceRoot, '../..');

const targetRoots = [
    path.join(repoRoot, 'apps/cli/src/runtime'),
    path.join(repoRoot, 'apps/macos-runner/runner'),
    path.join(repoRoot, 'apps/web/src/lib/runners'),
];

const filePattern = /\.(ts|tsx)$/;
const ignorePattern = /\.(test|spec)\.(ts|tsx)$/;

const forbiddenPatterns = [
    {
        regex: /capabilities\s*:\s*\[\s*['"]ANDROID['"]\s*\]/,
        message: 'hardcoded runner capability literal found',
    },
    {
        regex: /heartbeatIntervalSeconds\s*:\s*45/,
        message: 'hardcoded heartbeat fallback found',
    },
    {
        regex: /claimLongPollTimeoutSeconds\s*:\s*30/,
        message: 'hardcoded claim timeout fallback found',
    },
    {
        regex: /deviceSyncIntervalSeconds\s*:\s*45/,
        message: 'hardcoded device sync fallback found',
    },
];

function normalizePath(inputPath) {
    return inputPath.split(path.sep).join('/');
}

async function listSourceFiles(root) {
    const entries = await readdir(root, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listSourceFiles(fullPath));
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        if (!filePattern.test(entry.name)) {
            continue;
        }

        if (ignorePattern.test(entry.name)) {
            continue;
        }

        files.push(fullPath);
    }

    return files;
}

async function main() {
    const allFiles = [];
    for (const root of targetRoots) {
        allFiles.push(...await listSourceFiles(root));
    }

    const violations = [];

    for (const filePath of allFiles) {
        const source = await readFile(filePath, 'utf8');
        for (const pattern of forbiddenPatterns) {
            if (pattern.regex.test(source)) {
                violations.push(`${normalizePath(path.relative(repoRoot, filePath))}: ${pattern.message}`);
            }
        }
    }

    if (violations.length > 0) {
        console.error('Runner contract centralization check failed:');
        for (const violation of violations) {
            console.error(`- ${violation}`);
        }
        process.exit(1);
    }

    console.log(`Runner contract centralization check passed for ${allFiles.length} source files.`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

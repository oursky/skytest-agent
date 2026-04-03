#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const repoRoot = path.resolve(workspaceRoot, '../..');
const searchNeedle = '@skytest/runner-protocol/src/';
const excludedPath = 'apps/web/scripts/security/check-runner-protocol-boundary.mjs';
const searchRoots = [
    'apps/web',
    'apps/cli',
    'apps/macos-runner',
    'packages/runner-protocol',
];

function runSearchWithRipgrep() {
    const output = execFileSync(
        'rg',
        [
            '-n',
            searchNeedle,
            '--glob',
            `!${excludedPath}`,
            ...searchRoots,
        ],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );

    return output.trim();
}

function walkFiles(relativeDir) {
    const absoluteDir = path.resolve(repoRoot, relativeDir);
    const entries = readdirSync(absoluteDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.resolve(absoluteDir, entry.name);
        const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');

        if (entry.isDirectory()) {
            files.push(...walkFiles(relativePath));
            continue;
        }

        if (!entry.isFile() || relativePath === excludedPath) {
            continue;
        }

        files.push(relativePath);
    }

    return files;
}

function runSearchWithNode() {
    const files = searchRoots.flatMap((root) => walkFiles(root));
    const matches = [];

    for (const file of files) {
        const content = readFileSync(path.resolve(repoRoot, file), 'utf8');
        const lines = content.split(/\r?\n/);

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (!line.includes(searchNeedle)) {
                continue;
            }

            matches.push(`${file}:${index + 1}:${line}`);
        }
    }

    return matches.join('\n').trim();
}

function runSearch() {
    try {
        return runSearchWithRipgrep();
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return runSearchWithNode();
        }

        if (error instanceof Error && 'status' in error) {
            const status = Number(error.status);
            if (status === 1) {
                return '';
            }
        }

        const stderr = error && typeof error === 'object' && 'stderr' in error
            ? String(error.stderr || '')
            : '';
        if (stderr.trim()) {
            console.error(stderr.trim());
        }
        throw error;
    }
}

const violations = runSearch();
if (violations) {
    console.error('Runner protocol boundary check failed:');
    console.error('Direct subpath imports are prohibited. Use @skytest/runner-protocol root exports only.');
    console.error('Violations:');
    console.error(violations);
    process.exit(1);
}

console.log('Runner protocol boundary check passed (no subpath imports found).');

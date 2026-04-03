#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const workspaceRoot = process.cwd();
const repoRoot = path.resolve(workspaceRoot, '../..');

function runSearch() {
    try {
        const output = execFileSync(
            'rg',
            [
                '-n',
                "@skytest/runner-protocol/src/",
                '--glob',
                '!apps/web/scripts/security/check-runner-protocol-boundary.mjs',
                'apps/web',
                'apps/cli',
                'apps/macos-runner',
                'packages/runner-protocol',
            ],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        );
        return output.trim();
    } catch (error) {
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

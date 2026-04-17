#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webPackageJsonPath = path.resolve(scriptDir, '../../package.json');
const webPackageJson = JSON.parse(readFileSync(webPackageJsonPath, 'utf8'));
const verifyScript = String(webPackageJson.scripts?.verify ?? '');
const KNOWN_CHECKERS = Array.from(
    verifyScript.matchAll(/npm run ([A-Za-z0-9_:-]+)/g),
    (match) => match[1]
);

if (KNOWN_CHECKERS.length === 0) {
    console.error('verify:explain could not parse any checkers from apps/web/package.json scripts.verify');
    process.exit(2);
}

const result = spawnSync('npm', ['run', 'verify'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
});

const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';

process.stdout.write(stdout);
process.stderr.write(stderr);

if (result.status === 0) {
    process.exit(0);
}

const combined = `${stdout}\n${stderr}`;
const scriptHeaderRegex = /> @skytest\/web@[^\s]+\s+(\S+)/g;
let lastChecker = null;
for (const match of combined.matchAll(scriptHeaderRegex)) {
    const candidate = match[1];
    if (KNOWN_CHECKERS.includes(candidate)) {
        lastChecker = candidate;
    }
}

const errorLine = stderr
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('npm error') && !line.startsWith('npm warn'))
    ?? combined
        .split('\n')
        .map((line) => line.trim())
        .reverse()
        .find((line) =>
            line.length > 0
            && !line.startsWith('>')
            && !line.startsWith('npm error')
            && !line.startsWith('npm warn')
        )
    ?? 'unknown';

const attribution = lastChecker ?? 'unknown';

process.stderr.write(`\nVERIFY_FAILURE\n`);
process.stderr.write(`checker: ${attribution}\n`);
process.stderr.write(`first_error: ${errorLine}\n`);
process.stderr.write(`attribution: ${attributionLabel(attribution)}\n`);

process.exit(result.status ?? 1);

function attributionLabel(checker) {
    switch (checker) {
        case 'lint':
            return 'ESLint / TypeScript compile';
        case 'auth:check-routes':
            return 'auth route coverage';
        case 'protocol:check-boundary':
            return 'runner protocol boundary';
        case 'quality:check-client-imports':
            return 'client import boundary';
        case 'quality:check-hotspots':
            return 'hotspot LOC';
        case 'quality:check-config-i18n':
            return 'config/i18n guardrails';
        case 'quality:check-runner-contracts':
            return 'runner contract centralization';
        case 'security:check-lockfile-floors':
            return 'lockfile CVE floor';
        case 'quality:check-overrides-drift':
            return 'overrides drift';
        case 'audit':
            return 'npm audit';
        default:
            return checker === 'unknown' ? 'unknown' : `script "${checker}" (no friendly label)`;
    }
}

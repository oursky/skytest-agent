#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const repoRoot = path.resolve(workspaceRoot, '../..');
const apiRoot = path.resolve(workspaceRoot, 'src/app/api');
const allowlistPath = path.resolve(repoRoot, 'plans/auth-route-allowlist.md');

function normalizePath(inputPath) {
    return inputPath.split(path.sep).join('/');
}

async function listRouteFiles(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const child = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listRouteFiles(child));
            continue;
        }
        if (entry.isFile() && entry.name === 'route.ts') {
            files.push(child);
        }
    }

    return files;
}

function parseAllowlist(markdown) {
    const map = new Map();
    const lines = markdown.split('\n');

    for (const line of lines) {
        const rowMatch = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([^|]+)\|\s*$/.exec(line);
        if (!rowMatch) {
            continue;
        }

        const routeFile = rowMatch[1].trim();
        if (!routeFile.startsWith('apps/web/src/app/api/')) {
            continue;
        }

        map.set(routeFile, {
            methods: rowMatch[2].trim(),
            guardMode: rowMatch[3].trim(),
            reason: rowMatch[4].trim(),
        });
    }

    return map;
}

function hasStandardGuard(source) {
    return (
        /\bverifyAuth\(/.test(source)
        || /\bguardAuthenticatedUser\(/.test(source)
        || /\bguardProjectRouteRequest\(/.test(source)
    );
}

function validateAllowlistedGuardMode(input) {
    const { guardMode, source } = input;

    if (guardMode === 'authenticateRunnerRequest') {
        return /\bauthenticateRunnerRequest\(/.test(source);
    }

    if (guardMode === 'pairingTokenExchange') {
        return /\bexchangePairingToken\(/.test(source);
    }

    if (guardMode === 'publicTelemetry' || guardMode === 'publicProxy') {
        return /\bisRateLimited\(/.test(source);
    }

    if (guardMode === 'publicReadiness') {
        return /export\s+async\s+function\s+GET\s*\(/.test(source);
    }

    if (guardMode === 'nonOperational405') {
        return /status\s*:\s*405/.test(source);
    }

    return false;
}

async function main() {
    const allowlistMarkdown = await readFile(allowlistPath, 'utf8');
    const allowlist = parseAllowlist(allowlistMarkdown);
    const routeFiles = await listRouteFiles(apiRoot);
    const routePaths = routeFiles
        .map((absolutePath) => normalizePath(path.relative(repoRoot, absolutePath)))
        .sort();

    const violations = [];

    for (const routePath of routePaths) {
        const absolutePath = path.resolve(repoRoot, routePath);
        const source = await readFile(absolutePath, 'utf8');

        if (hasStandardGuard(source)) {
            continue;
        }

        const allowlistEntry = allowlist.get(routePath);
        if (!allowlistEntry) {
            violations.push(`${routePath}: missing standard guard and not present in plans/auth-route-allowlist.md`);
            continue;
        }

        const modeValid = validateAllowlistedGuardMode({
            guardMode: allowlistEntry.guardMode,
            source,
        });

        if (!modeValid) {
            violations.push(`${routePath}: allowlisted as ${allowlistEntry.guardMode} but route implementation does not match expected guard mode`);
        }
    }

    for (const allowlistedRoute of allowlist.keys()) {
        if (!routePaths.includes(allowlistedRoute)) {
            violations.push(`${allowlistedRoute}: listed in allowlist but route file does not exist`);
        }
    }

    if (violations.length > 0) {
        console.error('Auth route coverage check failed:');
        for (const violation of violations) {
            console.error(`- ${violation}`);
        }
        process.exit(1);
    }

    console.log(`Auth route coverage check passed for ${routePaths.length} routes (${allowlist.size} allowlisted exceptions).`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

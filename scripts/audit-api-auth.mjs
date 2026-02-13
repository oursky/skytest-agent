#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api');
const PUBLIC_ROUTE_ALLOWLIST = new Set([
    path.join(API_ROOT, 'authgear-proxy', 'route.ts'),
]);

async function findRouteFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await findRouteFiles(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name === 'route.ts') {
            files.push(fullPath);
        }
    }

    return files;
}

function toRepoRelative(filePath) {
    return path.relative(process.cwd(), filePath).replaceAll(path.sep, '/');
}

async function main() {
    const routeFiles = await findRouteFiles(API_ROOT);
    const missingAuth = [];

    for (const routeFile of routeFiles) {
        if (PUBLIC_ROUTE_ALLOWLIST.has(routeFile)) {
            continue;
        }

        const source = await fs.readFile(routeFile, 'utf8');
        if (!source.includes('verifyAuth(')) {
            missingAuth.push(toRepoRelative(routeFile));
        }
    }

    if (missingAuth.length === 0) {
        console.log(`Auth audit passed. Checked ${routeFiles.length} API routes.`);
        return;
    }

    console.error('Auth audit failed. Missing verifyAuth() in:');
    for (const file of missingAuth) {
        console.error(`- ${file}`);
    }
    process.exitCode = 1;
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});

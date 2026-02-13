#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, 'src', 'app', 'api');

const DYNAMIC_ROUTE_ALLOWLIST = new Set([
    'src/app/api/authgear-proxy/route.ts',
]);

const CRITICAL_ROUTE_SNIPPETS = new Map([
    [
        'src/app/api/run-test/route.ts',
        [
            'testCase.project.userId !== userId',
            "return NextResponse.json({ error: 'Forbidden' }, { status: 403 });",
        ],
    ],
    [
        'src/app/api/stream-tokens/route.ts',
        [
            "body.scope === 'project-events'",
            "body.scope === 'test-run-events'",
            "value === 'test-case-files'",
            'project.userId !== userId',
            'testRun.testCase.project.userId !== userId',
            'testCase.project.userId !== userId',
        ],
    ],
    [
        'src/app/api/test-runs/[id]/events/route.ts',
        [
            'project: { select: { userId: true } }',
            'testRun.testCase.project.userId !== userId',
            "return NextResponse.json({ error: 'Forbidden' }, { status: 403 });",
        ],
    ],
    [
        'src/app/api/test-runs/[id]/route.ts',
        [
            'project: { select: { userId: true } }',
            'testRun.testCase.project.userId !== authPayload.userId',
            "return NextResponse.json({ error: 'Forbidden' }, { status: 403 });",
        ],
    ],
    [
        'src/app/api/test-runs/[id]/cancel/route.ts',
        [
            'project: { select: { userId: true } }',
            'testRun.testCase.project.userId !== authPayload.userId',
            "return NextResponse.json({ error: 'Forbidden' }, { status: 403 });",
        ],
    ],
    [
        'src/app/api/test-cases/[id]/route.ts',
        [
            'project: { select: { userId: true } }',
            'testCase.project.userId !== userId',
            "return NextResponse.json({ error: 'Forbidden' }, { status: 403 });",
        ],
    ],
    [
        'src/app/api/test-cases/[id]/files/[fileId]/route.ts',
        [
            'project: { select: { userId: true } }',
            "scope: 'test-case-files'",
            "return NextResponse.json({ error: 'Forbidden' }, { status: 403 });",
        ],
    ],
    [
        'src/app/api/projects/[id]/route.ts',
        [
            'project.userId !== authPayload.userId',
            'existingProject.userId !== authPayload.userId',
            "return NextResponse.json({ error: 'Forbidden' }, { status: 403 });",
        ],
    ],
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

function toRelative(filePath) {
    return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

async function main() {
    const routeFiles = await findRouteFiles(API_ROOT);
    const missingForbiddenChecks = [];
    const missingCriticalSnippets = [];

    for (const routeFile of routeFiles) {
        const relativePath = toRelative(routeFile);
        const source = await fs.readFile(routeFile, 'utf8');

        const isDynamicRoute = relativePath.includes('/[');
        if (isDynamicRoute && !DYNAMIC_ROUTE_ALLOWLIST.has(relativePath)) {
            if (!source.includes("'Forbidden'")) {
                missingForbiddenChecks.push(relativePath);
            }
        }

        const snippets = CRITICAL_ROUTE_SNIPPETS.get(relativePath);
        if (!snippets) {
            continue;
        }

        const missing = snippets.filter((snippet) => !source.includes(snippet));
        if (missing.length > 0) {
            missingCriticalSnippets.push({ path: relativePath, missing });
        }
    }

    if (missingForbiddenChecks.length === 0 && missingCriticalSnippets.length === 0) {
        console.log(`Ownership audit passed. Checked ${routeFiles.length} API routes.`);
        return;
    }

    console.error('Ownership audit failed.');

    if (missingForbiddenChecks.length > 0) {
        console.error('\nDynamic routes missing explicit Forbidden handling:');
        for (const routePath of missingForbiddenChecks) {
            console.error(`- ${routePath}`);
        }
    }

    if (missingCriticalSnippets.length > 0) {
        console.error('\nCritical route ownership assertions missing:');
        for (const item of missingCriticalSnippets) {
            console.error(`- ${item.path}`);
            for (const snippet of item.missing) {
                console.error(`  • missing snippet: ${snippet}`);
            }
        }
    }

    process.exitCode = 1;
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});

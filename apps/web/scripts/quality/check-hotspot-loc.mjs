#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const repoRoot = path.resolve(workspaceRoot, '../..');
const exceptionsPath = path.resolve(workspaceRoot, 'scripts/quality/adr-loc-exceptions.json');

const exceptionConfig = JSON.parse(readFileSync(exceptionsPath, 'utf8'));
const maxLines = Number(exceptionConfig.maxLines ?? 900);
const creepThreshold = Number(exceptionConfig.creepThreshold ?? Math.floor(maxLines * 0.95));
const creepBaseRef = String(exceptionConfig.creepBaseRef ?? 'origin/main');
const exceptionPaths = new Set(
    Array.isArray(exceptionConfig.exceptions)
        ? exceptionConfig.exceptions.map((item) => String(item.path))
        : []
);

const cliArgs = new Set(process.argv.slice(2));
const strictCreep = cliArgs.has('--strict-creep') || process.env.STRICT_HOTSPOT_CREEP === '1';

const searchRoots = [
    'apps/web/src',
    'apps/cli/src',
    'apps/macos-runner/runner',
    'packages/runner-protocol/src',
];

function listFilesWithRipgrep() {
    const filesRaw = execFileSync(
        'rg',
        ['--files', ...searchRoots],
        {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );

    return filesRaw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
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

        if (!entry.isFile()) {
            continue;
        }

        files.push(relativePath);
    }

    return files;
}

function listFilesWithNode() {
    return searchRoots.flatMap((root) => walkFiles(root));
}

function listFiles() {
    try {
        return listFilesWithRipgrep();
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return listFilesWithNode();
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

function getBaseLineCount(file) {
    try {
        const contents = execFileSync('git', ['show', `${creepBaseRef}:${file}`], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (contents === '') {
            return 0;
        }
        const trimmed = contents.endsWith('\n') ? contents.slice(0, -1) : contents;
        return trimmed.split('\n').length;
    } catch {
        return null;
    }
}

const files = listFiles().filter((line) => /\.(ts|tsx)$/.test(line));

const oversized = [];
const creeping = [];
for (const file of files) {
    const countRaw = execFileSync('wc', ['-l', file], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    const lineCount = Number(countRaw.split(/\s+/)[0]);

    if (lineCount > maxLines) {
        oversized.push({
            path: file,
            lineCount,
            excepted: exceptionPaths.has(file),
        });
        continue;
    }

    if (lineCount >= creepThreshold && !exceptionPaths.has(file)) {
        const baseLineCount = getBaseLineCount(file);
        if (baseLineCount !== null && lineCount > baseLineCount) {
            creeping.push({
                path: file,
                lineCount,
                baseLineCount,
                addedLines: lineCount - baseLineCount,
            });
        }
    }
}

const violations = oversized.filter((item) => !item.excepted);

if (violations.length > 0) {
    console.error(`Hotspot LOC check failed: files above ${maxLines} lines without ADR exception:`);
    for (const item of violations) {
        console.error(`- ${item.path} (${item.lineCount})`);
    }
    process.exit(1);
}

if (creeping.length > 0) {
    const severity = strictCreep ? 'error' : 'warning';
    const stream = strictCreep ? console.error : console.warn;
    stream(
        `Hotspot creep ${severity} (threshold ${creepThreshold}/${maxLines}, base ${creepBaseRef}):`
    );
    for (const item of creeping) {
        stream(
            `- ${item.path}: ${item.baseLineCount} -> ${item.lineCount} (+${item.addedLines}). Consider extraction before adding more.`
        );
    }
    if (strictCreep) {
        process.exit(1);
    }
}

const excepted = oversized.filter((item) => item.excepted);
if (excepted.length > 0) {
    console.log(`Hotspot LOC check passed with ${excepted.length} ADR exceptions:`);
    for (const item of excepted) {
        console.log(`- ${item.path} (${item.lineCount})`);
    }
} else {
    console.log(`Hotspot LOC check passed: no files above ${maxLines} lines.`);
}

#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(currentFile), '../..');
const outputPath = process.argv[2];

if (!outputPath || outputPath.trim().length === 0) {
    console.error('Usage: node tools/release/build-runner-bundle.mjs <output-path>');
    process.exit(1);
}

await build({
    entryPoints: [path.join(rootDir, 'apps', 'macos-runner', 'runner', 'index.ts')],
    outfile: path.resolve(outputPath),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    sourcemap: false,
    tsconfig: path.join(rootDir, 'apps', 'web', 'tsconfig.json'),
    logLevel: 'info',
    external: [
        'fsevents',
        '*.node',
        'playwright',
        'playwright-core',
        '@playwright/test',
        '@midscene/web',
        '@midscene/web/*',
        '@midscene/android',
        '@midscene/android/*',
    ],
});

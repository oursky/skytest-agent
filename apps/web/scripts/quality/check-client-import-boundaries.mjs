#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const srcRoot = path.join(workspaceRoot, 'src');

const FORBIDDEN_IMPORT_RULES = [
    {
        matches: (specifier) => specifier === '@midscene/shared/env',
        reason: 'imports Node-dependent Midscene env entrypoint',
        suggestion: 'use @midscene/shared/env/types or a client-safe wrapper module',
    },
    {
        matches: (specifier) => specifier.startsWith('@midscene/shared/env/') && specifier !== '@midscene/shared/env/types',
        reason: 'imports non-types Midscene env subpath that may pull Node modules',
        suggestion: 'use @midscene/shared/env/types only',
    },
    {
        matches: (specifier) => specifier === '@/lib/runtime/midscene-env',
        reason: 'imports server runtime env builder into client bundle',
        suggestion: 'import from @/lib/runtime/model-families instead',
    },
];

function stripBom(source) {
    return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

function isClientModule(source) {
    const normalized = stripBom(source);
    const directivePattern = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use client\1\s*;?/;
    return directivePattern.test(normalized);
}

async function listSourceFiles(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            files.push(...await listSourceFiles(fullPath));
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        if (!/\.(ts|tsx)$/.test(entry.name)) {
            continue;
        }

        if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
            continue;
        }

        files.push(fullPath);
    }

    return files;
}

function extractImportSpecifiers(source) {
    const matches = [];
    const patterns = [
        /\bimport\s+[^'"]*?\sfrom\s*['"]([^'"]+)['"]/g,
        /\bimport\s*['"]([^'"]+)['"]/g,
        /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
        let match = pattern.exec(source);
        while (match) {
            matches.push({
                specifier: match[1],
                index: match.index,
            });
            match = pattern.exec(source);
        }
    }

    return matches;
}

function lineNumberAt(source, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1) {
        if (source[i] === '\n') {
            line += 1;
        }
    }
    return line;
}

async function main() {
    const sourceFiles = await listSourceFiles(srcRoot);
    const violations = [];

    for (const sourceFile of sourceFiles) {
        const source = await readFile(sourceFile, 'utf8');
        if (!isClientModule(source)) {
            continue;
        }

        const imports = extractImportSpecifiers(source);
        for (const imported of imports) {
            const rule = FORBIDDEN_IMPORT_RULES.find((candidate) => candidate.matches(imported.specifier));
            if (!rule) {
                continue;
            }

            violations.push({
                file: path.relative(workspaceRoot, sourceFile).split(path.sep).join('/'),
                line: lineNumberAt(source, imported.index),
                specifier: imported.specifier,
                reason: rule.reason,
                suggestion: rule.suggestion,
            });
        }
    }

    if (violations.length > 0) {
        console.error('Client import boundary check failed:');
        for (const violation of violations) {
            console.error(
                `- ${violation.file}:${violation.line} imports "${violation.specifier}" (${violation.reason}; ${violation.suggestion})`
            );
        }
        process.exit(1);
    }

    console.log('Client import boundary check passed: no forbidden imports found in use-client modules.');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});

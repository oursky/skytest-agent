import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import fg from 'fast-glob';
import type { TestCatalogEntry } from '@/types';
import { loadRuntimeConfigForCwd } from '@/lib/runtime/runtime-config-loader';

function hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

function parseTestCaseId(sourcePath: string, sourceContent: string): string {
    const parsed = parseYaml(sourceContent) as Record<string, unknown> | undefined;
    const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
    if (!id) {
        throw new Error(`Missing test case id in source file: ${sourcePath}`);
    }
    return id;
}

function toRelativeGlob(cwd: string, includePattern: string): string {
    if (path.isAbsolute(includePattern)) {
        const relative = path.relative(cwd, includePattern);
        return relative.startsWith('..') ? includePattern : relative;
    }
    return includePattern;
}

export async function loadTestCatalog(cwd: string): Promise<Map<string, TestCatalogEntry>> {
    const runtimeConfig = await loadRuntimeConfigForCwd(cwd);
    const includePatterns = runtimeConfig.catalog?.include ?? [];
    if (includePatterns.length === 0) {
        return new Map();
    }

    const excludePatterns = runtimeConfig.catalog?.exclude ?? [];
    const sourcePaths = await fg(
        includePatterns.map((pattern) => toRelativeGlob(cwd, pattern)),
        {
            cwd,
            absolute: true,
            dot: true,
            onlyFiles: true,
            ignore: excludePatterns,
        }
    );

    const catalog = new Map<string, TestCatalogEntry>();
    for (const sourcePath of sourcePaths) {
        const sourceContent = await readFile(sourcePath, 'utf8');
        const id = parseTestCaseId(sourcePath, sourceContent);

        if (catalog.has(id)) {
            const existing = catalog.get(id);
            throw new Error(
                `Duplicate test case ID "${id}" discovered in ${existing?.sourcePath ?? 'unknown'} and ${sourcePath}`
            );
        }

        catalog.set(id, {
            id,
            sourcePath,
            sourceHash: hashContent(sourceContent),
        });
    }

    return catalog;
}

export function hashCatalogDocument(content: string): string {
    return hashContent(content);
}

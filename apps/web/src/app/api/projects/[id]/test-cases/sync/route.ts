import path from 'node:path';
import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { load as parseYaml } from 'js-yaml';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { loadTestCatalog, hashCatalogDocument } from '@/lib/test-cases/catalog-loader';
import { loadRuntimeConfigForCwd } from '@/lib/runtime/runtime-config-loader';
import { cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import type { BrowserConfig, TargetConfig, TestStep } from '@/types';

const logger = createLogger('api:projects:test-cases:sync');

function resolveCatalogRootFromSourcePath(sourcePath: string | null | undefined): string | null {
    if (!sourcePath) {
        return null;
    }

    const normalizedPath = path.normalize(sourcePath);
    const marker = `${path.sep}.skytest${path.sep}`;
    const markerIndex = normalizedPath.indexOf(marker);
    if (markerIndex < 0) {
        return null;
    }

    return normalizedPath.slice(0, markerIndex);
}

function sanitizeJsonResponse(runSync: {
    imported: number;
    updated: number;
    runtimeConfigsSynced: number;
    root: string;
}) {
    return {
        imported: runSync.imported,
        updated: runSync.updated,
        runtimeConfigsSynced: runSync.runtimeConfigsSynced,
        root: runSync.root,
    };
}

function parseCaseDocument(raw: string, sourcePath: string): {
    id: string;
    name: string;
    url: string;
    prompt?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
} {
    const parsed = parseYaml(raw) as Record<string, unknown> | undefined;
    const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
    const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
    const url = typeof parsed?.url === 'string' ? parsed.url.trim() : '';

    if (!id || !name || !url) {
        throw new Error(`Invalid test case source file ${sourcePath}: id/name/url are required`);
    }

    const steps = Array.isArray(parsed?.steps) ? (parsed?.steps as TestStep[]) : undefined;
    const browserConfig = parsed?.browserConfig
        && typeof parsed.browserConfig === 'object'
        && !Array.isArray(parsed.browserConfig)
        ? (parsed.browserConfig as Record<string, BrowserConfig | TargetConfig>)
        : undefined;

    return {
        id,
        name,
        url,
        prompt: typeof parsed?.prompt === 'string' ? parsed.prompt : undefined,
        steps,
        browserConfig,
    };
}

interface SyncRequestBody {
    root?: string;
    dryRun?: boolean;
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id: projectId } = guard.params;
        const body = await request.json().catch(() => ({})) as SyncRequestBody;
        const explicitRoot = typeof body.root === 'string' ? body.root.trim() : '';
        const dryRun = body.dryRun === true;

        let catalogRoot = explicitRoot;
        if (!catalogRoot) {
            const sourceBackedCase = await prisma.testCase.findFirst({
                where: { projectId, source: { not: null } },
                select: { source: true },
            });
            catalogRoot = resolveCatalogRootFromSourcePath(sourceBackedCase?.source) ?? '';
        }

        if (!catalogRoot) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'Unable to resolve file catalog root. Provide request body `{ "root": "/absolute/path" }`.',
            });
        }

        let runtimeConfig;
        try {
            runtimeConfig = await loadRuntimeConfigForCwd(catalogRoot);
        } catch (error) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: error instanceof Error ? error.message : 'Invalid runtime config',
            });
        }

        const catalog = await loadTestCatalog(catalogRoot);
        if (catalog.size === 0) {
            return apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                error: 'No case files discovered from runtime catalog include patterns',
            });
        }

        const existingCases = await prisma.testCase.findMany({
            where: { projectId },
            select: { id: true, displayId: true, status: true },
        });
        const existingByDisplayId = new Map(
            existingCases
                .filter((testCase) => typeof testCase.displayId === 'string' && testCase.displayId.trim().length > 0)
                .map((testCase) => [testCase.displayId as string, testCase])
        );

        let imported = 0;
        let updated = 0;

        for (const entry of catalog.values()) {
            const raw = await readFile(entry.sourcePath, 'utf8');
            const parsed = parseCaseDocument(raw, entry.sourcePath);

            const normalizedSteps = parsed.steps ? cleanStepsForStorage(parsed.steps) : [];
            const normalizedBrowserConfig = parsed.browserConfig
                ? normalizeTargetConfigMap(parsed.browserConfig)
                : {};

            const nextData = {
                name: parsed.name,
                url: parsed.url,
                prompt: parsed.prompt ?? null,
                steps: JSON.stringify(normalizedSteps),
                browserConfig: JSON.stringify(normalizedBrowserConfig),
                source: entry.sourcePath,
                sourceHash: hashCatalogDocument(raw),
            };

            const existing = existingByDisplayId.get(parsed.id);
            if (existing) {
                if (!dryRun) {
                    await prisma.testCase.update({
                        where: { id: existing.id },
                        data: nextData,
                    });
                }
                updated += 1;
                continue;
            }

            if (!dryRun) {
                await prisma.testCase.create({
                    data: {
                        projectId,
                        displayId: parsed.id,
                        status: 'DRAFT',
                        ...nextData,
                    },
                });
            }
            imported += 1;
        }

        const runtimeEnvEntries = Object.entries(runtimeConfig.runtime.env ?? {})
            .filter(([name, value]) => Boolean(name.trim()) && typeof value === 'string' && value.trim().length > 0)
            .map(([name, value]) => ({
                name: name.trim(),
                value: value.trim(),
                masked: /PASSWORD|TOKEN|SECRET|KEY/i.test(name),
            }));

        if (!dryRun) {
            for (const entry of runtimeEnvEntries) {
                await prisma.projectConfig.upsert({
                    where: {
                        projectId_name: {
                            projectId,
                            name: entry.name,
                        },
                    },
                    create: {
                        projectId,
                        name: entry.name,
                        type: 'VARIABLE',
                        value: entry.value,
                        masked: entry.masked,
                    },
                    update: {
                        type: 'VARIABLE',
                        value: entry.value,
                        masked: entry.masked,
                    },
                });
            }
        }

        return NextResponse.json(sanitizeJsonResponse({
            imported,
            updated,
            runtimeConfigsSynced: runtimeEnvEntries.length,
            root: catalogRoot,
        }));
    } catch (error) {
        logger.error('Failed to sync project test cases from catalog source', error);
        return apiError({
            status: 500,
            code: 'INTERNAL_ERROR',
            error: 'Failed to sync project test cases from source files',
        });
    }
}

import { NextResponse } from 'next/server';
import { apiError } from '@/lib/security/api-route-standards';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { cleanStepsForStorage } from '@/lib/runtime/test-case-utils';
import { TEST_CASE_KIND, TEST_STATUS, type BrowserConfig, type TargetConfig, type TestCaseKind, type TestStep } from '@/types';
import { guardProjectRouteRequest } from '@/lib/security/project-route-access';
import { validateLoginFlowReferences, collectLoginFlowIds } from '@/lib/test-cases/login-flow-access';
import { parseTestCaseTargets } from '@/lib/test-config/browser-target';
import { parseSerializedJson } from '@/lib/runtime/local-browser-runner-parsers';

const logger = createLogger('api:projects:test-cases');

export const dynamic = 'force-dynamic';

function parseTestCaseKind(value: string | null | undefined): TestCaseKind {
    return value === TEST_CASE_KIND.LOGIN_FLOW ? TEST_CASE_KIND.LOGIN_FLOW : TEST_CASE_KIND.TEST;
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardProjectRouteRequest({ request, params });
    if (!guard.ok) {
        return guard.response;
    }

    try {
        const { id } = guard.params;
        const { searchParams } = new URL(request.url);
        const kind = parseTestCaseKind(searchParams.get('kind'));
        const isSummaryMode = searchParams.has('summary')
            || searchParams.has('search')
            || searchParams.has('page')
            || searchParams.has('limit');

        if (isSummaryMode) {
            const search = searchParams.get('search')?.trim() ?? '';
            const pageParam = Number.parseInt(searchParams.get('page') ?? '1', 10);
            const limitParam = Number.parseInt(searchParams.get('limit') ?? '20', 10);
            const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
            const limit = Number.isFinite(limitParam) && limitParam > 0
                ? Math.min(limitParam, 100)
                : 20;

            const where = search
                ? {
                    projectId: id,
                    kind,
                    OR: [
                        { displayId: { contains: search, mode: 'insensitive' as const } },
                        { name: { contains: search, mode: 'insensitive' as const } },
                    ],
                }
                : { projectId: id, kind };

            const [total, testCases] = await prisma.$transaction([
                prisma.testCase.count({ where }),
                prisma.testCase.findMany({
                    where,
                    skip: (page - 1) * limit,
                    take: limit,
                    orderBy: [
                        { displayId: 'asc' },
                        { name: 'asc' },
                    ],
                    select: {
                        id: true,
                        displayId: true,
                        name: true,
                        kind: true,
                        browserConfig: true,
                    },
                }),
            ]);

            return NextResponse.json({
                data: testCases.map(({ browserConfig, ...rest }) => ({
                    ...rest,
                    targets: parseTestCaseTargets(browserConfig),
                })),
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / limit)),
                },
            });
        }

        const testCases = await prisma.testCase.findMany({
            where: { projectId: id },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                displayId: true,
                kind: true,
                status: true,
                name: true,
                updatedAt: true,
                browserConfig: true,
                testRuns: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        status: true,
                        createdAt: true,
                    },
                },
                source: true,
                sourceHash: true,
            },
        });

        const loginFlowUsage = new Map<string, number>();
        for (const testCase of testCases) {
            if (testCase.kind === TEST_CASE_KIND.LOGIN_FLOW) {
                continue;
            }
            const browserConfig = parseSerializedJson<Record<string, BrowserConfig | TargetConfig>>(testCase.browserConfig);
            for (const flowId of collectLoginFlowIds(browserConfig)) {
                loginFlowUsage.set(flowId, (loginFlowUsage.get(flowId) ?? 0) + 1);
            }
        }

        return NextResponse.json(testCases.map(({ browserConfig, ...testCase }) => {
            void browserConfig;
            return {
                ...testCase,
                sourcePath: testCase.source,
                sourceHash: testCase.sourceHash,
                ...(testCase.kind === TEST_CASE_KIND.LOGIN_FLOW
                    ? { usedByCount: loginFlowUsage.get(testCase.id) ?? 0 }
                    : {}),
            };
        }));
    } catch (error) {
        logger.error('Failed to fetch test cases', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to fetch test cases' });
    }
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
        const { id } = guard.params;

        const body: unknown = await request.json();
        const { name, url, prompt, steps, browserConfig, displayId, kind: rawKind, saveDraft } = (body ?? {}) as {
            name?: string;
            url?: string;
            prompt?: string;
            steps?: unknown;
            browserConfig?: unknown;
            displayId?: string;
            kind?: string;
            saveDraft?: boolean;
        };

        const hasSteps = Array.isArray(steps) && steps.length > 0;
        const hasBrowserConfig = !!browserConfig && typeof browserConfig === 'object' && !Array.isArray(browserConfig) && Object.keys(browserConfig as Record<string, unknown>).length > 0;
        const cleanedSteps = hasSteps ? cleanStepsForStorage(steps as TestStep[]) : undefined;
        const normalizedDisplayId = typeof displayId === 'string' ? displayId.trim() : '';
        const kind = parseTestCaseKind(rawKind);

        if (!name) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Name is required' });
        }
        if (!normalizedDisplayId) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Test case ID is required' });
        }
        if (!saveDraft && ((!url && !hasBrowserConfig) || (!prompt && !hasSteps))) {
            return apiError({ status: 400, code: 'VALIDATION_ERROR', error: 'Name, and either URL or BrowserConfig, and either Prompt or Steps are required' });
        }

        if (hasBrowserConfig) {
            const loginFlowValidation = await validateLoginFlowReferences({
                projectId: id,
                hostKind: kind,
                browserConfig: browserConfig as Record<string, BrowserConfig | TargetConfig>,
            });
            if (!loginFlowValidation.ok) {
                return apiError({ status: 400, code: 'VALIDATION_ERROR', error: loginFlowValidation.error });
            }
        }

        const testCase = await prisma.testCase.create({
            data: {
                name,
                url: url || '',
                prompt,
                steps: cleanedSteps ? JSON.stringify(cleanedSteps) : undefined,
                browserConfig: hasBrowserConfig ? JSON.stringify(browserConfig) : undefined,
                projectId: id,
                displayId: normalizedDisplayId,
                kind,
                status: TEST_STATUS.DRAFT,
            },
        });

        return NextResponse.json({
            ...testCase,
            sourcePath: testCase.source,
            sourceHash: testCase.sourceHash,
        });
    } catch (error) {
        logger.error('Failed to create test case', error);
        return apiError({ status: 500, code: 'INTERNAL_ERROR', error: 'Failed to create test case' });
    }
}

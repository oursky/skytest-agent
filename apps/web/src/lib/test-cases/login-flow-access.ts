import { prisma } from '@/lib/core/prisma';
import { TEST_CASE_KIND, type BrowserConfig, type TargetConfig } from '@/types';

export function collectLoginFlowIds(
    browserConfig: Record<string, BrowserConfig | TargetConfig> | null | undefined,
): string[] {
    if (!browserConfig) {
        return [];
    }
    const ids = new Set<string>();
    for (const target of Object.values(browserConfig)) {
        if (target && 'type' in target && target.type === 'android') {
            continue;
        }
        const loginFlowId = (target as BrowserConfig).loginFlowId;
        if (typeof loginFlowId === 'string' && loginFlowId.trim()) {
            ids.add(loginFlowId.trim());
        }
    }
    return [...ids];
}

export type LoginFlowValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validates every loginFlowId referenced by a test case's browser targets:
 * the host must not be a login flow itself (no chaining), it must not reference
 * itself, and each reference must resolve to a LOGIN_FLOW test case in the same
 * project.
 */
export async function validateLoginFlowReferences(params: {
    projectId: string;
    hostKind: string;
    testCaseId?: string;
    browserConfig: Record<string, BrowserConfig | TargetConfig> | null | undefined;
}): Promise<LoginFlowValidationResult> {
    const ids = collectLoginFlowIds(params.browserConfig);
    if (ids.length === 0) {
        return { ok: true };
    }
    if (params.hostKind === TEST_CASE_KIND.LOGIN_FLOW) {
        return { ok: false, error: 'A login flow cannot reference another login flow' };
    }
    if (params.testCaseId && ids.includes(params.testCaseId)) {
        return { ok: false, error: 'A test case cannot reference itself as its login flow' };
    }

    const found = await prisma.testCase.findMany({
        where: {
            id: { in: ids },
            projectId: params.projectId,
            kind: TEST_CASE_KIND.LOGIN_FLOW,
        },
        select: { id: true },
    });
    const foundIds = new Set(found.map((testCase) => testCase.id));
    if (ids.some((id) => !foundIds.has(id))) {
        return { ok: false, error: 'Login Flow must reference a login flow in this project' };
    }
    return { ok: true };
}

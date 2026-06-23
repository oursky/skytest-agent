import { prisma } from '@/lib/core/prisma';
import { BROWSER_EXECUTION_CAPABILITY } from '@/lib/runners/constants';
import { createRunSession } from '@/lib/runtime/run-session-service';
import {
    RUN_SESSION_KIND,
    TEST_CASE_KIND,
    TEST_STATUS,
    RUN_ACTIVE_STATUSES,
    type TestGroupSummary,
    type TestGroupSessionSummary,
    type TestGroupUpsertInput,
    type RunTriggerSource,
} from '@/types';

export type TestGroupResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 404 | 409; error: string };

function normalizeUpsert(input: TestGroupUpsertInput): { name: string; displayId: string | null; loginFlowId: string | null; testCaseIds: string[] } {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const displayId = typeof input.displayId === 'string' && input.displayId.trim() ? input.displayId.trim() : null;
    const loginFlowId = typeof input.loginFlowId === 'string' && input.loginFlowId.trim() ? input.loginFlowId.trim() : null;
    const seen = new Set<string>();
    const testCaseIds = Array.isArray(input.testCaseIds)
        ? input.testCaseIds.filter((id) => typeof id === 'string' && id && !seen.has(id) && (seen.add(id), true))
        : [];
    return { name, displayId, loginFlowId, testCaseIds };
}

/** Validates that a group's case ids and optional login flow belong to the project and are the right kind. */
async function validateGroupMembers(
    projectId: string,
    testCaseIds: string[],
    loginFlowId: string | null,
): Promise<TestGroupResult<true>> {
    if (testCaseIds.length > 0) {
        const cases = await prisma.testCase.findMany({
            where: { id: { in: testCaseIds }, projectId, kind: TEST_CASE_KIND.TEST },
            select: { id: true },
        });
        if (cases.length !== testCaseIds.length) {
            return { ok: false, status: 400, error: 'All test group items must be test cases in this project' };
        }
    }
    if (loginFlowId) {
        const flow = await prisma.testCase.findFirst({
            where: { id: loginFlowId, projectId, kind: TEST_CASE_KIND.LOGIN_FLOW },
            select: { id: true },
        });
        if (!flow) {
            return { ok: false, status: 400, error: 'Login flow must be a login flow in this project' };
        }
    }
    return { ok: true, data: true };
}

function serializeTestGroup(group: {
    id: string;
    name: string;
    displayId: string | null;
    loginFlowId: string | null;
    updatedAt: Date;
    items: { testCaseId: string; position: number; testCase: { displayId: string | null; name: string; browserConfig: string | null } }[];
    sessions: { id: string; status: string; createdAt: Date }[];
}): TestGroupSummary {
    const latest = group.sessions[0];
    return {
        id: group.id,
        name: group.name,
        displayId: group.displayId,
        loginFlowId: group.loginFlowId,
        items: group.items
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((item) => ({
                testCaseId: item.testCaseId,
                position: item.position,
                displayId: item.testCase.displayId,
                name: item.testCase.name,
            })),
        lastSessionId: latest?.id ?? null,
        lastSessionStatus: latest?.status ?? null,
        lastSessionAt: latest?.createdAt.toISOString() ?? null,
        updatedAt: group.updatedAt.toISOString(),
    };
}

const groupInclude = {
    items: { include: { testCase: { select: { displayId: true, name: true, browserConfig: true } } } },
    sessions: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' as const }, take: 1, select: { id: true, status: true, createdAt: true } },
};

export async function listTestGroups(projectId: string): Promise<TestGroupSummary[]> {
    const groups = await prisma.testGroup.findMany({
        where: { projectId },
        orderBy: { updatedAt: 'desc' },
        include: groupInclude,
    });
    return groups.map(serializeTestGroup);
}

export async function listTestGroupSessions(
    projectId: string,
    groupId: string,
    page: number,
    limit: number,
): Promise<TestGroupResult<{ groupName: string; projectName: string; sessions: TestGroupSessionSummary[]; total: number }>> {
    const group = await prisma.testGroup.findFirst({
        where: { id: groupId, projectId },
        select: { id: true, name: true, project: { select: { name: true } } },
    });
    if (!group) {
        return { ok: false, status: 404, error: 'Test group not found' };
    }
    const where = { testGroupId: groupId, deletedAt: null };
    const [total, sessions] = await prisma.$transaction([
        prisma.runSession.count({ where }),
        prisma.runSession.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
            select: {
                id: true,
                status: true,
                createdAt: true,
                completedAt: true,
                triggeredByEmail: true,
                triggerSource: true,
                _count: { select: { memberRuns: true } },
            },
        }),
    ]);
    return {
        ok: true,
        data: {
            groupName: group.name,
            projectName: group.project.name,
            total,
            sessions: sessions.map((session) => ({
                id: session.id,
                status: session.status,
                createdAt: session.createdAt.toISOString(),
                completedAt: session.completedAt?.toISOString() ?? null,
                memberCount: session._count.memberRuns,
                triggeredByEmail: session.triggeredByEmail,
                triggerSource: session.triggerSource,
            })),
        },
    };
}

export async function getTestGroup(projectId: string, groupId: string): Promise<TestGroupSummary | null> {
    const group = await prisma.testGroup.findFirst({
        where: { id: groupId, projectId },
        include: groupInclude,
    });
    return group ? serializeTestGroup(group) : null;
}

export async function createTestGroup(projectId: string, input: TestGroupUpsertInput): Promise<TestGroupResult<TestGroupSummary>> {
    const { name, displayId, loginFlowId, testCaseIds } = normalizeUpsert(input);
    if (!name) {
        return { ok: false, status: 400, error: 'Name is required' };
    }
    const validation = await validateGroupMembers(projectId, testCaseIds, loginFlowId);
    if (!validation.ok) {
        return validation;
    }
    const group = await prisma.testGroup.create({
        data: {
            projectId,
            name,
            displayId,
            loginFlowId,
            items: { create: testCaseIds.map((testCaseId, position) => ({ testCaseId, position })) },
        },
        include: groupInclude,
    });
    return { ok: true, data: serializeTestGroup(group) };
}

export async function updateTestGroup(projectId: string, groupId: string, input: TestGroupUpsertInput): Promise<TestGroupResult<TestGroupSummary>> {
    const existing = await prisma.testGroup.findFirst({ where: { id: groupId, projectId }, select: { id: true } });
    if (!existing) {
        return { ok: false, status: 404, error: 'Test group not found' };
    }
    const { name, displayId, loginFlowId, testCaseIds } = normalizeUpsert(input);
    if (!name) {
        return { ok: false, status: 400, error: 'Name is required' };
    }
    const validation = await validateGroupMembers(projectId, testCaseIds, loginFlowId);
    if (!validation.ok) {
        return validation;
    }
    const group = await prisma.$transaction(async (tx) => {
        await tx.testGroupItem.deleteMany({ where: { testGroupId: groupId } });
        return tx.testGroup.update({
            where: { id: groupId },
            data: {
                name,
                displayId,
                loginFlowId,
                items: { create: testCaseIds.map((testCaseId, position) => ({ testCaseId, position })) },
            },
            include: groupInclude,
        });
    });
    return { ok: true, data: serializeTestGroup(group) };
}

export async function deleteTestGroup(projectId: string, groupId: string): Promise<TestGroupResult<true>> {
    const existing = await prisma.testGroup.findFirst({ where: { id: groupId, projectId }, select: { id: true } });
    if (!existing) {
        return { ok: false, status: 404, error: 'Test group not found' };
    }
    await prisma.testGroup.delete({ where: { id: groupId } });
    return { ok: true, data: true };
}

export interface QueueTestGroupOptions {
    triggeredByEmail?: string | null;
    triggerSource: RunTriggerSource;
}

/**
 * Materializes a test group into a GROUP run session: an optional "start with"
 * login-flow member, then each case in order. Rejects if the group is empty or
 * already has an active session (a group cannot run twice concurrently).
 */
export async function queueTestGroupRun(
    projectId: string,
    groupId: string,
    options: QueueTestGroupOptions,
): Promise<TestGroupResult<{ sessionId: string }>> {
    const group = await prisma.testGroup.findFirst({
        where: { id: groupId, projectId },
        include: { items: { orderBy: { position: 'asc' }, select: { testCaseId: true } } },
    });
    if (!group) {
        return { ok: false, status: 404, error: 'Test group not found' };
    }
    if (group.items.length === 0) {
        return { ok: false, status: 400, error: 'Test group has no test cases' };
    }

    const activeSession = await prisma.runSession.findFirst({
        where: { testGroupId: groupId, deletedAt: null, status: { in: [...RUN_ACTIVE_STATUSES] } },
        select: { id: true },
    });
    if (activeSession) {
        return { ok: false, status: 409, error: 'This test group already has a run in progress' };
    }

    const runSessionId = await createRunSession({
        projectId,
        kind: RUN_SESSION_KIND.GROUP,
        testGroupId: groupId,
        requiredCapability: BROWSER_EXECUTION_CAPABILITY,
        triggeredByEmail: options.triggeredByEmail,
        triggerSource: options.triggerSource,
    });

    let position = 0;
    const memberData: { testCaseId: string; sessionPosition: number; kind: string }[] = [];
    if (group.loginFlowId) {
        const flow = await prisma.testCase.findFirst({
            where: { id: group.loginFlowId, projectId, kind: TEST_CASE_KIND.LOGIN_FLOW },
            select: { id: true },
        });
        if (flow) {
            memberData.push({ testCaseId: flow.id, sessionPosition: position, kind: TEST_CASE_KIND.LOGIN_FLOW });
            position += 1;
        }
    }
    for (const item of group.items) {
        memberData.push({ testCaseId: item.testCaseId, sessionPosition: position, kind: TEST_CASE_KIND.TEST });
        position += 1;
    }

    await prisma.testRun.createMany({
        data: memberData.map((member) => ({
            testCaseId: member.testCaseId,
            runSessionId,
            sessionPosition: member.sessionPosition,
            kind: member.kind,
            status: TEST_STATUS.QUEUED,
            requiredCapability: BROWSER_EXECUTION_CAPABILITY,
            triggeredByEmail: options.triggeredByEmail ?? null,
            triggerSource: options.triggerSource,
        })),
    });

    return { ok: true, data: { sessionId: runSessionId } };
}

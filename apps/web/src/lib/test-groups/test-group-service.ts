import { prisma } from '@/lib/core/prisma';
import { BROWSER_EXECUTION_CAPABILITY } from '@/lib/runners/constants';
import { createRunSession } from '@/lib/runtime/run-session-service';
import {
    RUN_SESSION_KIND,
    TEST_CASE_KIND,
    TEST_STATUS,
    RUN_ACTIVE_STATUSES,
    TEST_GROUP_FAILURE_MODE,
    type TestGroupFailureMode,
    type TestGroupSummary,
    type TestGroupSessionSummary,
    type TestGroupRunPreview,
    type TestGroupRunPreviewMember,
    type TestGroupUpsertInput,
    type RunTriggerSource,
} from '@/types';

export type TestGroupResult<T> = { ok: true; data: T } | { ok: false; status: 400 | 404 | 409; error: string };

interface NormalizedUpsert {
    name: string;
    displayId: string | null;
    onFailure: TestGroupFailureMode;
    loginSessions: { loginFlowId: string; name: string }[];
    testCaseIds: string[];
}

/** Default name for a login session by index: "Login Session A", "B", … (falls back to a number past Z). */
function defaultLoginSessionName(index: number): string {
    const letter = index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
    return `Login Session ${letter}`;
}

function normalizeUpsert(input: TestGroupUpsertInput): NormalizedUpsert {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const displayId = typeof input.displayId === 'string' && input.displayId.trim() ? input.displayId.trim() : null;
    const onFailure: TestGroupFailureMode = input.onFailure === TEST_GROUP_FAILURE_MODE.CONTINUE
        ? TEST_GROUP_FAILURE_MODE.CONTINUE
        : TEST_GROUP_FAILURE_MODE.STOP;

    const seenFlows = new Set<string>();
    const loginSessions = Array.isArray(input.loginSessions)
        ? input.loginSessions
            .map((session) => ({
                loginFlowId: typeof session.loginFlowId === 'string' ? session.loginFlowId.trim() : '',
                name: typeof session.name === 'string' ? session.name.trim() : '',
            }))
            .filter((session) => session.loginFlowId && !seenFlows.has(session.loginFlowId) && (seenFlows.add(session.loginFlowId), true))
            .map((session, index) => ({ loginFlowId: session.loginFlowId, name: session.name || defaultLoginSessionName(index) }))
        : [];

    const seenCases = new Set<string>();
    const testCaseIds = Array.isArray(input.testCaseIds)
        ? input.testCaseIds.filter((id) => typeof id === 'string' && id && !seenCases.has(id) && (seenCases.add(id), true))
        : [];
    return { name, displayId, onFailure, loginSessions, testCaseIds };
}

/** Validates that a group's case ids and login-session flow ids belong to the project and are the right kind. */
async function validateGroupMembers(
    projectId: string,
    testCaseIds: string[],
    loginFlowIds: string[],
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
    if (loginFlowIds.length > 0) {
        const flows = await prisma.testCase.findMany({
            where: { id: { in: loginFlowIds }, projectId, kind: TEST_CASE_KIND.LOGIN_FLOW },
            select: { id: true },
        });
        if (flows.length !== loginFlowIds.length) {
            return { ok: false, status: 400, error: 'Every login session must reference a login flow in this project' };
        }
    }
    return { ok: true, data: true };
}

/** Whether a group has a run session that is still queued/preparing/running. */
async function hasActiveSession(groupId: string): Promise<boolean> {
    const active = await prisma.runSession.findFirst({
        where: { testGroupId: groupId, deletedAt: null, status: { in: [...RUN_ACTIVE_STATUSES] } },
        select: { id: true },
    });
    return active !== null;
}

interface SerializableTestGroup {
    id: string;
    name: string;
    displayId: string | null;
    onFailure: string;
    updatedAt: Date;
    loginSessions: { id: string; loginFlowId: string; name: string; position: number; loginFlow: { displayId: string | null; name: string } }[];
    items: { testCaseId: string; position: number; testCase: { displayId: string | null; name: string } }[];
    sessions: { id: string; status: string; createdAt: Date }[];
}

function serializeTestGroup(group: SerializableTestGroup): TestGroupSummary {
    const latest = group.sessions[0];
    return {
        id: group.id,
        name: group.name,
        displayId: group.displayId,
        onFailure: group.onFailure === TEST_GROUP_FAILURE_MODE.CONTINUE
            ? TEST_GROUP_FAILURE_MODE.CONTINUE
            : TEST_GROUP_FAILURE_MODE.STOP,
        loginSessions: group.loginSessions
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((session) => ({
                id: session.id,
                loginFlowId: session.loginFlowId,
                name: session.name,
                position: session.position,
                displayId: session.loginFlow.displayId,
                flowName: session.loginFlow.name,
            })),
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
    loginSessions: { include: { loginFlow: { select: { displayId: true, name: true } } } },
    items: { include: { testCase: { select: { displayId: true, name: true } } } },
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

/**
 * Builds the run-launcher preview for a group: the cases that will run (login flows
 * first, then test cases in order), each with its latest run status and start time so
 * the launcher mirrors the live "Test Group Run" table before a run is triggered.
 */
export async function getTestGroupRunPreview(projectId: string, groupId: string): Promise<TestGroupRunPreview | null> {
    const group = await prisma.testGroup.findFirst({
        where: { id: groupId, projectId },
        select: {
            id: true,
            name: true,
            displayId: true,
            loginSessions: { select: { loginFlowId: true, position: true, loginFlow: { select: { displayId: true, name: true } } } },
            items: { select: { testCaseId: true, position: true, testCase: { select: { displayId: true, name: true } } } },
        },
    });
    if (!group) {
        return null;
    }

    const orderedMembers = [
        ...group.loginSessions
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((session, index) => ({
                testCaseId: session.loginFlowId,
                kind: TEST_CASE_KIND.LOGIN_FLOW,
                position: index,
                displayId: session.loginFlow.displayId,
                name: session.loginFlow.name,
            })),
        ...group.items
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((item, index) => ({
                testCaseId: item.testCaseId,
                kind: TEST_CASE_KIND.TEST,
                position: group.loginSessions.length + index,
                displayId: item.testCase.displayId,
                name: item.testCase.name,
            })),
    ];

    const caseIds = orderedMembers.map((member) => member.testCaseId);
    const latestRuns = caseIds.length > 0
        ? await prisma.testRun.findMany({
            where: { testCaseId: { in: caseIds }, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { testCaseId: true, status: true, startedAt: true, createdAt: true },
        })
        : [];
    const latestByCase = new Map<string, { status: string; startedAt: Date | null; createdAt: Date }>();
    for (const run of latestRuns) {
        if (!latestByCase.has(run.testCaseId)) {
            latestByCase.set(run.testCaseId, run);
        }
    }

    const activeSession = await prisma.runSession.findFirst({
        where: { testGroupId: groupId, deletedAt: null, status: { in: [...RUN_ACTIVE_STATUSES] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
    });

    const members: TestGroupRunPreviewMember[] = orderedMembers.map((member) => {
        const latest = latestByCase.get(member.testCaseId);
        return {
            testCaseId: member.testCaseId,
            kind: member.kind,
            position: member.position,
            displayId: member.displayId,
            name: member.name,
            status: latest?.status ?? null,
            startedAt: (latest?.startedAt ?? latest?.createdAt)?.toISOString() ?? null,
        };
    });

    return {
        id: group.id,
        name: group.name,
        displayId: group.displayId,
        members,
        activeSessionId: activeSession?.id ?? null,
        activeSessionStatus: activeSession?.status ?? null,
    };
}

export async function createTestGroup(projectId: string, input: TestGroupUpsertInput): Promise<TestGroupResult<TestGroupSummary>> {
    const { name, displayId, onFailure, loginSessions, testCaseIds } = normalizeUpsert(input);
    if (!name) {
        return { ok: false, status: 400, error: 'Name is required' };
    }
    const validation = await validateGroupMembers(projectId, testCaseIds, loginSessions.map((session) => session.loginFlowId));
    if (!validation.ok) {
        return validation;
    }
    const group = await prisma.testGroup.create({
        data: {
            projectId,
            name,
            displayId,
            onFailure,
            loginSessions: { create: loginSessions.map((session, position) => ({ loginFlowId: session.loginFlowId, name: session.name, position })) },
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
    if (await hasActiveSession(groupId)) {
        return { ok: false, status: 409, error: 'This test group is running and cannot be edited' };
    }
    const { name, displayId, onFailure, loginSessions, testCaseIds } = normalizeUpsert(input);
    if (!name) {
        return { ok: false, status: 400, error: 'Name is required' };
    }
    const validation = await validateGroupMembers(projectId, testCaseIds, loginSessions.map((session) => session.loginFlowId));
    if (!validation.ok) {
        return validation;
    }
    const group = await prisma.$transaction(async (tx) => {
        await tx.testGroupItem.deleteMany({ where: { testGroupId: groupId } });
        await tx.testGroupLoginSession.deleteMany({ where: { testGroupId: groupId } });
        return tx.testGroup.update({
            where: { id: groupId },
            data: {
                name,
                displayId,
                onFailure,
                loginSessions: { create: loginSessions.map((session, position) => ({ loginFlowId: session.loginFlowId, name: session.name, position })) },
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
    if (await hasActiveSession(groupId)) {
        return { ok: false, status: 409, error: 'This test group is running and cannot be deleted' };
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
        include: {
            items: { orderBy: { position: 'asc' }, select: { testCaseId: true } },
            loginSessions: { orderBy: { position: 'asc' }, select: { loginFlowId: true } },
        },
    });
    if (!group) {
        return { ok: false, status: 404, error: 'Test group not found' };
    }
    if (group.items.length === 0) {
        return { ok: false, status: 400, error: 'Test group has no test cases' };
    }

    if (await hasActiveSession(groupId)) {
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
    // One login-flow member per login session establishes a reusable baseline; the
    // orchestrator captures each session's storageState and restores it for the cases
    // whose targets reuse it.
    const sessionFlowIds = group.loginSessions.map((session) => session.loginFlowId);
    if (sessionFlowIds.length > 0) {
        const validFlows = await prisma.testCase.findMany({
            where: { id: { in: sessionFlowIds }, projectId, kind: TEST_CASE_KIND.LOGIN_FLOW },
            select: { id: true },
        });
        const validFlowIds = new Set(validFlows.map((flow) => flow.id));
        for (const loginFlowId of sessionFlowIds) {
            if (validFlowIds.has(loginFlowId)) {
                memberData.push({ testCaseId: loginFlowId, sessionPosition: position, kind: TEST_CASE_KIND.LOGIN_FLOW });
                position += 1;
            }
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

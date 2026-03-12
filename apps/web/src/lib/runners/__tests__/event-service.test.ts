import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    findUniqueRun,
    updateManyRun,
    createManyEvents,
    updateRun,
    findUniqueTestCase,
    updateTestCase,
    findUniqueUser,
    findUniqueProject,
    upsertUsageRecord,
    createRunFile,
    updateManyLock,
    deleteManyLock,
    countLocks,
    transaction,
    putObjectBuffer,
} = vi.hoisted(() => ({
    findUniqueRun: vi.fn(),
    updateManyRun: vi.fn(),
    createManyEvents: vi.fn(),
    updateRun: vi.fn(),
    findUniqueTestCase: vi.fn(),
    updateTestCase: vi.fn(),
    findUniqueUser: vi.fn(),
    findUniqueProject: vi.fn(),
    upsertUsageRecord: vi.fn(),
    createRunFile: vi.fn(),
    updateManyLock: vi.fn(),
    deleteManyLock: vi.fn(),
    countLocks: vi.fn(),
    transaction: vi.fn(),
    putObjectBuffer: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        $transaction: transaction,
        testRun: {
            findUnique: findUniqueRun,
            update: updateRun,
        },
        testCase: {
            findUnique: findUniqueTestCase,
        },
        user: {
            findUnique: findUniqueUser,
        },
        project: {
            findUnique: findUniqueProject,
        },
        usageRecord: {
            upsert: upsertUsageRecord,
            create: vi.fn(),
        },
        testRunFile: {
            create: createRunFile,
        },
    },
}));

vi.mock('@/lib/storage/object-store-utils', () => ({
    putObjectBuffer,
}));

const { appendRunEvents, completeOwnedRun, failOwnedRun } = await import('@/lib/runners/event-service');

describe('event-service', () => {
    beforeEach(() => {
        findUniqueRun.mockReset();
        updateManyRun.mockReset();
        createManyEvents.mockReset();
        updateRun.mockReset();
        findUniqueTestCase.mockReset();
        updateTestCase.mockReset();
        findUniqueUser.mockReset();
        findUniqueProject.mockReset();
        upsertUsageRecord.mockReset();
        createRunFile.mockReset();
        updateManyLock.mockReset();
        deleteManyLock.mockReset();
        countLocks.mockReset();
        transaction.mockReset();
        putObjectBuffer.mockReset();

        transaction.mockImplementation(async (callback: (tx: {
            testRun: {
                findUnique: typeof findUniqueRun;
                updateMany: typeof updateManyRun;
                update: typeof updateRun;
            };
            androidResourceLock: {
                updateMany: typeof updateManyLock;
                deleteMany: typeof deleteManyLock;
                count: typeof countLocks;
            };
            testRunEvent: {
                createMany: typeof createManyEvents;
            };
            testCase: {
                update: typeof updateTestCase;
            };
        }) => Promise<unknown>) => callback({
            testRun: {
                findUnique: findUniqueRun,
                updateMany: updateManyRun,
                update: updateRun,
            },
            androidResourceLock: {
                updateMany: updateManyLock,
                deleteMany: deleteManyLock,
                count: countLocks,
            },
            testRunEvent: {
                createMany: createManyEvents,
            },
            testCase: {
                update: updateTestCase,
            },
        }));
        updateManyRun.mockResolvedValue({ count: 1 });
        updateManyLock.mockResolvedValue({ count: 1 });
        deleteManyLock.mockResolvedValue({ count: 1 });
        countLocks.mockResolvedValue(1);
        findUniqueTestCase.mockResolvedValue({
            name: 'Checkout flow',
            project: {
                id: 'project-1',
                name: 'Shop',
                createdByUserId: 'user-1',
            }
        });
        findUniqueUser.mockResolvedValue({ id: 'user-1' });
        findUniqueProject.mockResolvedValue({ id: 'project-1' });
        upsertUsageRecord.mockResolvedValue({ id: 'usage-1' });
    });

    it('appends events with reserved sequence numbers', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 4,
        });

        const result = await appendRunEvents({
            runId: 'run-1',
            runnerId: 'runner-1',
            events: [
                { kind: 'STEP', message: 'one' },
                { kind: 'STEP', message: 'two' },
            ],
        });

        expect(updateManyRun).toHaveBeenCalledWith({
            where: {
                id: 'run-1',
                assignedRunnerId: 'runner-1',
                nextEventSequence: 4,
            },
            data: {
                nextEventSequence: 6,
                lastEventAt: expect.any(Date),
                leaseExpiresAt: expect.any(Date),
            },
        });
        expect(createManyEvents).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ runId: 'run-1', sequence: 4, kind: 'STEP' }),
                expect.objectContaining({ runId: 'run-1', sequence: 5, kind: 'STEP' }),
            ],
        });
        expect(updateManyLock).toHaveBeenCalledWith({
            where: {
                runId: 'run-1',
                runnerId: 'runner-1',
            },
            data: {
                leaseExpiresAt: expect.any(Date),
            },
        });
        expect(result).toEqual({ accepted: 2, nextSequence: 6 });
    });

    it('keeps PREPARING when only setup logs arrive', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'PREPARING',
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 1,
        });

        await appendRunEvents({
            runId: 'run-1',
            runnerId: 'runner-1',
            events: [{ kind: 'LOG', message: 'Device acquired: emulator-5554' }],
        });

        expect(updateManyRun).toHaveBeenCalledWith({
            where: {
                id: 'run-1',
                assignedRunnerId: 'runner-1',
                nextEventSequence: 1,
            },
            data: {
                nextEventSequence: 2,
                lastEventAt: expect.any(Date),
                leaseExpiresAt: expect.any(Date),
            },
        });
    });

    it('promotes PREPARING runs to RUNNING on explicit running status event', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'PREPARING',
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 1,
        });

        await appendRunEvents({
            runId: 'run-1',
            runnerId: 'runner-1',
            events: [{ kind: 'STATUS', message: 'Running test steps' }],
        });

        expect(updateManyRun).toHaveBeenCalledWith({
            where: {
                id: 'run-1',
                assignedRunnerId: 'runner-1',
                nextEventSequence: 1,
            },
            data: {
                status: 'RUNNING',
                nextEventSequence: 2,
                lastEventAt: expect.any(Date),
                leaseExpiresAt: expect.any(Date),
            },
        });
    });

    it('rejects appending when run ownership is invalid', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            assignedRunnerId: 'runner-2',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 1,
        });

        const result = await appendRunEvents({
            runId: 'run-1',
            runnerId: 'runner-1',
            events: [{ kind: 'STEP' }],
        });

        expect(result).toBeNull();
        expect(updateManyRun).not.toHaveBeenCalled();
        expect(createManyEvents).not.toHaveBeenCalled();
    });

    it('rejects appending for explicit-device run when resource lock is missing', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            requestedDeviceId: 'device-a',
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 1,
        });
        countLocks.mockResolvedValueOnce(0);

        const result = await appendRunEvents({
            runId: 'run-1',
            runnerId: 'runner-1',
            events: [{ kind: 'STEP' }],
        });

        expect(result).toBeNull();
        expect(updateManyRun).not.toHaveBeenCalled();
        expect(createManyEvents).not.toHaveBeenCalled();
    });

    it('marks owned runs completed', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 1,
        });

        const result = await completeOwnedRun({
            runId: 'run-1',
            runnerId: 'runner-1',
            result: '{"ok":true,"actionCount":3}',
        });

        expect(updateRun).toHaveBeenCalledWith({
            where: { id: 'run-1' },
            data: {
                status: 'PASS',
                result: '{"ok":true,"actionCount":3}',
                completedAt: expect.any(Date),
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });
        expect(deleteManyLock).toHaveBeenCalledWith({
            where: {
                runId: 'run-1',
            },
        });
        expect(updateTestCase).toHaveBeenCalledWith({
            where: { id: 'tc-1' },
            data: { status: 'PASS' },
        });
        expect(upsertUsageRecord).toHaveBeenCalledWith({
            where: { testRunId: 'run-1' },
            update: {
                actorUserId: 'user-1',
                projectId: 'project-1',
                type: 'TEST_RUN',
                description: 'Shop - Checkout flow',
                aiActions: 3,
            },
            create: {
                actorUserId: 'user-1',
                projectId: 'project-1',
                type: 'TEST_RUN',
                description: 'Shop - Checkout flow',
                aiActions: 3,
                testRunId: 'run-1',
            }
        });
        expect(result).toEqual({ runId: 'run-1', status: 'PASS' });
    });

    it('records usage when owned runs fail', async () => {
        findUniqueRun.mockResolvedValueOnce({
            id: 'run-1',
            testCaseId: 'tc-1',
            status: 'RUNNING',
            assignedRunnerId: 'runner-1',
            leaseExpiresAt: new Date(Date.now() + 10_000),
            nextEventSequence: 1,
        });

        const result = await failOwnedRun({
            runId: 'run-1',
            runnerId: 'runner-1',
            error: 'Step failed',
            result: '{"status":"FAIL","actionCount":2}',
        });

        expect(updateRun).toHaveBeenCalledWith({
            where: { id: 'run-1' },
            data: {
                status: 'FAIL',
                error: 'Step failed',
                result: '{"status":"FAIL","actionCount":2}',
                completedAt: expect.any(Date),
                assignedRunnerId: null,
                leaseExpiresAt: null,
            },
        });
        expect(deleteManyLock).toHaveBeenCalledWith({
            where: {
                runId: 'run-1',
            },
        });
        expect(updateTestCase).toHaveBeenCalledWith({
            where: { id: 'tc-1' },
            data: { status: 'FAIL' },
        });
        expect(upsertUsageRecord).toHaveBeenCalledWith({
            where: { testRunId: 'run-1' },
            update: {
                actorUserId: 'user-1',
                projectId: 'project-1',
                type: 'TEST_RUN',
                description: 'Shop - Checkout flow',
                aiActions: 2,
            },
            create: {
                actorUserId: 'user-1',
                projectId: 'project-1',
                type: 'TEST_RUN',
                description: 'Shop - Checkout flow',
                aiActions: 2,
                testRunId: 'run-1',
            }
        });
        expect(result).toEqual({ runId: 'run-1', status: 'FAIL' });
    });
});

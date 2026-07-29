import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TargetConfig, TestStep } from '@/types';
import type { ParseResult } from '@/utils/excel/testCaseExcel';

const mocks = vi.hoisted(() => ({
    projectFindUnique: vi.fn(),
    runnerFindMany: vi.fn(),
    testCaseFindMany: vi.fn(),
    getTeamDevicesAvailability: vi.fn(),
    parseTestCaseExcel: vi.fn(),
    testCaseUpdate: vi.fn(),
    testCaseCreate: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock('@/lib/core/prisma', () => ({
    prisma: {
        project: {
            findUnique: mocks.projectFindUnique,
        },
        runner: {
            findMany: mocks.runnerFindMany,
        },
        testCase: {
            findMany: mocks.testCaseFindMany,
        },
        $transaction: mocks.transaction,
    },
}));

vi.mock('@/lib/runners/availability-service', () => ({
    getTeamDevicesAvailability: mocks.getTeamDevicesAvailability,
}));

vi.mock('@/utils/excel/testCaseExcel', () => ({
    parseTestCaseExcel: mocks.parseTestCaseExcel,
}));

const { processProjectBatchImport } = await import('@/lib/test-cases/batch-import-service');

function buildAndroidTarget(params: {
    profileName: string;
    runnerId?: string;
}): TargetConfig {
    return {
        type: 'android',
        name: 'Android A',
        deviceSelector: {
            mode: 'emulator-profile',
            emulatorProfileName: params.profileName,
        },
        runnerScope: params.runnerId ? { runnerId: params.runnerId } : undefined,
        appId: 'com.example.app',
        clearAppState: true,
        allowAllPermissions: true,
    };
}

function buildParseResult(targetConfig: Record<string, TargetConfig>): ParseResult {
    const steps: TestStep[] = [{ id: 'step_1', target: 'android_a', action: 'Open app' }];

    return {
        data: {
            testCaseId: 'TC-1',
            testData: {
                name: 'Import Android Case',
                displayId: 'TC-1',
                url: '',
                prompt: '',
                steps,
                browserConfig: targetConfig,
            },
            projectVariables: [],
            testCaseVariables: [],
            files: [],
        },
        warnings: [],
        issues: [],
    };
}

describe('processProjectBatchImport Android runner/device validation', () => {
    // Android runner/device gaps are recoverable at run time, so they surface as
    // warnings (incomplete) rather than hard errors that block import entirely.
    beforeEach(() => {
        mocks.projectFindUnique.mockReset();
        mocks.runnerFindMany.mockReset();
        mocks.testCaseFindMany.mockReset();
        mocks.getTeamDevicesAvailability.mockReset();
        mocks.parseTestCaseExcel.mockReset();

        mocks.projectFindUnique.mockResolvedValue({ teamId: 'team-1' });
        mocks.runnerFindMany.mockResolvedValue([
            { id: 'runner-1', displayId: 'run001' },
            { id: 'runner-2', displayId: 'run002' },
        ]);
        mocks.testCaseFindMany.mockResolvedValue([]);
    });

    it('marks Android target invalid when runner id is missing even if selector maps uniquely', async () => {
        mocks.getTeamDevicesAvailability.mockResolvedValue({
            devices: [{ runnerId: 'runner-1', deviceId: 'emulator-profile:android_profile_a' }],
        });
        mocks.parseTestCaseExcel.mockResolvedValue(
            buildParseResult({
                android_a: buildAndroidTarget({ profileName: 'android_profile_a' }),
            })
        );

        const result = await processProjectBatchImport({
            projectId: 'project-1',
            mode: 'validate',
            files: [{ filename: 'case.xlsx', content: new Uint8Array([1]).buffer }],
        });

        expect(result.summary.incompleteFiles).toBe(1);
        expect(result.files[0].issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'ANDROID_RUNNER_REQUIRED',
                    severity: 'warning',
                }),
            ])
        );
    });

    it('marks Android target invalid when runner id is missing and selector is duplicated', async () => {
        mocks.getTeamDevicesAvailability.mockResolvedValue({
            devices: [
                { runnerId: 'runner-1', deviceId: 'emulator-profile:android_profile_a' },
                { runnerId: 'runner-2', deviceId: 'emulator-profile:android_profile_a' },
            ],
        });
        mocks.parseTestCaseExcel.mockResolvedValue(
            buildParseResult({
                android_a: buildAndroidTarget({ profileName: 'android_profile_a' }),
            })
        );

        const result = await processProjectBatchImport({
            projectId: 'project-1',
            mode: 'validate',
            files: [{ filename: 'case.xlsx', content: new Uint8Array([1]).buffer }],
        });

        expect(result.summary.incompleteFiles).toBe(1);
        expect(result.files[0].issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'ANDROID_RUNNER_REQUIRED',
                    severity: 'warning',
                }),
            ])
        );
    });

    it('marks unknown runner id as invalid', async () => {
        mocks.getTeamDevicesAvailability.mockResolvedValue({
            devices: [{ runnerId: 'runner-1', deviceId: 'emulator-profile:android_profile_a' }],
        });
        mocks.parseTestCaseExcel.mockResolvedValue(
            buildParseResult({
                android_a: buildAndroidTarget({
                    profileName: 'android_profile_a',
                    runnerId: 'runner-missing',
                }),
            })
        );

        const result = await processProjectBatchImport({
            projectId: 'project-1',
            mode: 'validate',
            files: [{ filename: 'case.xlsx', content: new Uint8Array([1]).buffer }],
        });

        expect(result.summary.incompleteFiles).toBe(1);
        expect(result.files[0].issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'ANDROID_RUNNER_NOT_FOUND',
                    severity: 'warning',
                }),
            ])
        );
    });

    it('accepts runner display id mapping when it resolves to paired runner id', async () => {
        mocks.getTeamDevicesAvailability.mockResolvedValue({
            devices: [{ runnerId: 'runner-1', deviceId: 'emulator-profile:android_profile_a' }],
        });
        mocks.parseTestCaseExcel.mockResolvedValue(
            buildParseResult({
                android_a: buildAndroidTarget({
                    profileName: 'android_profile_a',
                    runnerId: 'run001',
                }),
            })
        );

        const result = await processProjectBatchImport({
            projectId: 'project-1',
            mode: 'validate',
            files: [{ filename: 'case.xlsx', content: new Uint8Array([1]).buffer }],
        });

        expect(result.summary.completeFiles).toBe(1);
        expect(result.files[0].issues).toEqual([]);
    });

    it('marks runner-device mismatch invalid when selected runner does not expose requested device', async () => {
        mocks.getTeamDevicesAvailability.mockResolvedValue({
            devices: [{ runnerId: 'runner-1', deviceId: 'emulator-profile:android_profile_a' }],
        });
        mocks.parseTestCaseExcel.mockResolvedValue(
            buildParseResult({
                android_a: buildAndroidTarget({
                    profileName: 'android_profile_a',
                    runnerId: 'runner-2',
                }),
            })
        );

        const result = await processProjectBatchImport({
            projectId: 'project-1',
            mode: 'validate',
            files: [{ filename: 'case.xlsx', content: new Uint8Array([1]).buffer }],
        });

        expect(result.summary.incompleteFiles).toBe(1);
        expect(result.files[0].issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'ANDROID_RUNNER_DEVICE_MISMATCH',
                    severity: 'warning',
                }),
            ])
        );
    });
});

describe('processProjectBatchImport prompt handling on re-import', () => {
    beforeEach(() => {
        mocks.projectFindUnique.mockReset();
        mocks.runnerFindMany.mockReset();
        mocks.testCaseFindMany.mockReset();
        mocks.getTeamDevicesAvailability.mockReset();
        mocks.parseTestCaseExcel.mockReset();
        mocks.testCaseUpdate.mockReset();
        mocks.testCaseCreate.mockReset();
        mocks.transaction.mockReset();

        mocks.projectFindUnique.mockResolvedValue({ teamId: 'team-1' });
        mocks.runnerFindMany.mockResolvedValue([]);
        mocks.getTeamDevicesAvailability.mockResolvedValue({ devices: [] });
        mocks.testCaseFindMany.mockResolvedValue([{ id: 'tc-1', displayId: 'TC-1' }]);
        mocks.testCaseCreate.mockResolvedValue({ id: 'tc-1' });
        mocks.transaction.mockImplementation(async (run: (tx: unknown) => Promise<string>) => run({
            testCase: { update: mocks.testCaseUpdate, create: mocks.testCaseCreate },
        }));
    });

    async function importBrowserCase(prompt: string | undefined) {
        mocks.parseTestCaseExcel.mockResolvedValue({
            data: {
                testCaseId: 'TC-1',
                testData: {
                    name: 'Prompt Case',
                    displayId: 'TC-1',
                    url: 'https://example.com',
                    ...(prompt !== undefined ? { prompt } : {}),
                    steps: [{ id: 'step_1', target: 'browser_a', action: 'Open' }] as TestStep[],
                    browserConfig: { browser_a: { url: 'https://example.com', width: 1280, height: 720 } },
                },
                projectVariables: [],
                testCaseVariables: [],
                files: [],
            },
            warnings: [],
            issues: [],
        } as ParseResult);

        return processProjectBatchImport({
            projectId: 'project-1',
            mode: 'import-valid',
            files: [{ filename: 'case.xlsx', content: new Uint8Array([1]).buffer }],
        });
    }

    it('keeps the existing prompt when the workbook carries no Prompt row', async () => {
        await importBrowserCase(undefined);

        expect(mocks.testCaseUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.testCaseUpdate.mock.calls[0][0].data).not.toHaveProperty('prompt');
    });

    it('writes the prompt when the workbook carries one', async () => {
        await importBrowserCase('Log in and check the dashboard');

        expect(mocks.testCaseUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.testCaseUpdate.mock.calls[0][0].data.prompt).toBe('Log in and check the dashboard');
    });
});

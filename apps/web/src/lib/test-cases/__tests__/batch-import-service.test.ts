import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TargetConfig, TestStep } from '@/types';
import type { ParseResult } from '@/utils/excel/testCaseExcel';

const mocks = vi.hoisted(() => ({
    projectFindUnique: vi.fn(),
    runnerFindMany: vi.fn(),
    testCaseFindMany: vi.fn(),
    getTeamDevicesAvailability: vi.fn(),
    parseTestCaseExcel: vi.fn(),
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
        $transaction: vi.fn(),
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

        expect(result.summary.invalidFiles).toBe(1);
        expect(result.files[0].issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'ANDROID_RUNNER_REQUIRED',
                    severity: 'error',
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

        expect(result.summary.invalidFiles).toBe(1);
        expect(result.files[0].issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'ANDROID_RUNNER_REQUIRED',
                    severity: 'error',
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

        expect(result.summary.invalidFiles).toBe(1);
        expect(result.files[0].issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'ANDROID_RUNNER_NOT_FOUND',
                    severity: 'error',
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

        expect(result.summary.validFiles).toBe(1);
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

        expect(result.summary.invalidFiles).toBe(1);
        expect(result.files[0].issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'ANDROID_RUNNER_DEVICE_MISMATCH',
                    severity: 'error',
                }),
            ])
        );
    });
});

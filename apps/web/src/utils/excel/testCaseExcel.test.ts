import { describe, expect, it } from 'vitest';
import { exportToExcelArrayBuffer, parseTestCaseExcel } from './testCaseExcel';

describe('testCaseExcel import/export contract', () => {
    it('exports test file rows and reports manual upload warning on import', async () => {
        const workbook = await exportToExcelArrayBuffer({
            name: 'Checkout Flow',
            testCaseId: 'TC-100',
            steps: [{
                id: '1',
                target: 'browser_a',
                type: 'ai-action',
                action: 'Open page',
            }],
            browserConfig: {
                browser_a: {
                    url: 'https://example.com',
                    width: 1280,
                    height: 720,
                },
            },
            files: [{
                filename: 'products.csv',
                mimeType: 'text/csv',
                size: 1024,
            }],
        });

        const parsed = await parseTestCaseExcel(workbook);
        expect(parsed.data.files).toHaveLength(1);
        expect(parsed.data.files[0]?.filename).toBe('products.csv');
        expect(parsed.issues.some((issue) => issue.code === 'FILE_ATTACHMENT_MANUAL_UPLOAD_REQUIRED')).toBe(true);
    });

    it('reports row-level error when a test step action is missing', async () => {
        const workbook = await exportToExcelArrayBuffer({
            name: 'Missing Action Case',
            testCaseId: 'TC-101',
            steps: [{
                id: '1',
                target: 'browser_a',
                type: 'ai-action',
                action: '',
            }],
            browserConfig: {
                browser_a: {
                    url: 'https://example.com',
                    width: 1280,
                    height: 720,
                },
            },
        });

        const parsed = await parseTestCaseExcel(workbook);
        expect(parsed.issues.some((issue) => issue.code === 'MISSING_STEP_ACTION' && issue.severity === 'error')).toBe(true);
    });

    it('round-trips Android runner scope through export and import', async () => {
        const workbook = await exportToExcelArrayBuffer({
            name: 'Android Runner Scope',
            testCaseId: 'TC-102',
            steps: [{
                id: '1',
                target: 'android_a',
                type: 'ai-action',
                action: 'Open app',
            }],
            browserConfig: {
                android_a: {
                    type: 'android',
                    name: 'Pixel 8',
                    deviceSelector: {
                        mode: 'emulator-profile',
                        emulatorProfileName: 'android_profile_a',
                    },
                    runnerScope: {
                        runnerId: 'runner-1',
                    },
                    appId: 'com.example.app',
                    clearAppState: true,
                    allowAllPermissions: true,
                },
            },
        });

        const parsed = await parseTestCaseExcel(workbook);
        const parsedAndroidTarget = parsed.data.testData.browserConfig?.android_a;
        if (!parsedAndroidTarget || !('type' in parsedAndroidTarget) || parsedAndroidTarget.type !== 'android') {
            throw new Error('Expected android target');
        }
        expect(parsedAndroidTarget.runnerScope?.runnerId).toBe('runner-1');
    });
});

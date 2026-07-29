import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { exportToExcelArrayBuffer, parseTestCaseExcel } from './testCaseExcel';

async function buildLegacyBrowserTargetWorkbook(): Promise<ArrayBuffer> {
    const workbook = new ExcelJS.Workbook();
    const configurations = workbook.addWorksheet('Configurations');
    configurations.addRow(['Section', 'Type', 'Name', 'Value']);
    configurations.addRow(['Basic Info', 'Test Case Name', 'Legacy Export', '']);

    const targets = workbook.addWorksheet('Browser Targets');
    targets.addRow(['Target', 'Name', 'URL', 'Width', 'Height', 'Login Flow']);
    targets.addRow(['Browser A', '', 'https://example.com', '1280', '720', '']);

    const stepsSheet = workbook.addWorksheet('Test Steps');
    stepsSheet.addRow(['Step No', 'Browser', 'Type', 'Action']);
    stepsSheet.addRow([1, 'Browser A', 'AI', 'Open']);

    return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

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

    it('round-trips login flow reference and kind through export and import', async () => {
        const workbook = await exportToExcelArrayBuffer({
            name: 'Dashboard',
            testCaseId: 'TC-200',
            kind: 'TEST',
            steps: [{ id: '1', target: 'browser_a', type: 'ai-action', action: 'Open' }],
            browserConfig: {
                browser_a: { url: 'https://example.com', width: 1280, height: 720, loginFlowId: 'lf-cuid-1' },
            },
            loginFlowDisplayIdById: { 'lf-cuid-1': 'LF-1' },
        });

        const parsed = await parseTestCaseExcel(workbook);
        expect(parsed.data.testData.kind).toBe('TEST');
        const target = parsed.data.testData.browserConfig?.browser_a as { loginFlowId?: string };
        expect(target?.loginFlowId).toBe('LF-1');
    });

    it('round-trips the passkey and reuse-session flags through export and import', async () => {
        const workbook = await exportToExcelArrayBuffer({
            name: 'Passkey Signup',
            testCaseId: 'TC-250',
            steps: [{ id: '1', target: 'browser_a', type: 'ai-action', action: 'Open' }],
            browserConfig: {
                browser_a: {
                    url: 'https://example.com',
                    width: 1280,
                    height: 720,
                    webauthnVirtualAuthenticator: true,
                    loginFlowId: 'lf-cuid-1',
                    reuseGroupSession: true,
                },
                browser_b: { url: 'https://example.org', width: 1280, height: 720 },
            },
            loginFlowDisplayIdById: { 'lf-cuid-1': 'LF-1' },
        });

        const parsed = await parseTestCaseExcel(workbook);
        const targets = parsed.data.testData.browserConfig as Record<string, {
            webauthnVirtualAuthenticator?: boolean;
            reuseGroupSession?: boolean;
        }>;
        expect(targets.browser_a?.webauthnVirtualAuthenticator).toBe(true);
        expect(targets.browser_a?.reuseGroupSession).toBe(true);
        expect(targets.browser_b?.webauthnVirtualAuthenticator).toBe(false);
        expect(targets.browser_b?.reuseGroupSession).toBe(false);
    });

    it('leaves both flags unset when their columns are absent', async () => {
        const parsed = await parseTestCaseExcel(await buildLegacyBrowserTargetWorkbook());
        const target = parsed.data.testData.browserConfig?.browser_a as {
            webauthnVirtualAuthenticator?: boolean;
            reuseGroupSession?: boolean;
        };
        expect(target?.webauthnVirtualAuthenticator).toBeUndefined();
        expect(target?.reuseGroupSession).toBeUndefined();
    });

    it('round-trips a multiline prompt through export and import', async () => {
        const prompt = 'Log in as an admin.\nThen open Reports and confirm the totals match.';
        const workbook = await exportToExcelArrayBuffer({
            name: 'Prompt Mode',
            testCaseId: 'TC-260',
            url: 'https://example.com',
            prompt,
            browserConfig: {
                browser_a: { url: 'https://example.com', width: 1280, height: 720 },
            },
        });

        const parsed = await parseTestCaseExcel(workbook);
        expect(parsed.data.testData.prompt).toBe(prompt);
        expect(parsed.data.testData.url).toBe('https://example.com');
    });

    it('reports no prompt when the workbook predates the Prompt row', async () => {
        const parsed = await parseTestCaseExcel(await buildLegacyBrowserTargetWorkbook());
        expect(parsed.data.testData.prompt).toBeUndefined();
    });

    it('round-trips the primary URL for an android-only test case', async () => {
        const workbook = await exportToExcelArrayBuffer({
            name: 'Android Only',
            testCaseId: 'TC-270',
            url: 'https://example.com',
            browserConfig: {
                android_a: {
                    type: 'android',
                    deviceSelector: { mode: 'emulator-profile', emulatorProfileName: 'Pixel 8' },
                    appId: 'com.example.app',
                    clearAppState: true,
                    allowAllPermissions: true,
                },
            },
        });

        const parsed = await parseTestCaseExcel(workbook);
        expect(parsed.data.testData.url).toBe('https://example.com');
    });

    it('round-trips FILE variable metadata (filename, mime, size) through export and import', async () => {
        const workbook = await exportToExcelArrayBuffer({
            name: 'Upload Case',
            testCaseId: 'TC-300',
            steps: [{ id: '1', target: 'browser_a', type: 'ai-action', action: 'Open' }],
            browserConfig: {
                browser_a: { url: 'https://example.com', width: 1280, height: 720 },
            },
            testCaseVariables: [{
                name: 'DATA_FILE',
                type: 'FILE',
                value: 'data.csv',
                filename: 'data.csv',
                mimeType: 'text/csv',
                size: 2048,
            }],
        });

        const parsed = await parseTestCaseExcel(workbook);
        const fileVar = parsed.data.testCaseVariables.find((variable) => variable.type === 'FILE');
        expect(fileVar?.filename).toBe('data.csv');
        expect(fileVar?.mimeType).toBe('text/csv');
        expect(fileVar?.size).toBe(2048);
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

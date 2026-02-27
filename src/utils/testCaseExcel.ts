import ExcelJS, { CellValue, Worksheet } from 'exceljs';
import type { BrowserConfig, TargetConfig, ConfigType, TestStep } from '@/types';
import { normalizeAndroidTargetConfig } from '@/lib/android-target-config';
import { formatAndroidDeviceSelectorDisplay } from '@/lib/android-device-selector-display';
import { compareByGroupThenName, isGroupableConfigType, normalizeConfigGroup } from '@/lib/config-sort';
import { normalizeBrowserConfig } from '@/lib/browser-target';

type SupportedVariableType = Extract<ConfigType, 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING' | 'FILE'>;
const BROWSER_TARGET_SHEET_NAMES = ['Browser Targets', 'Browsers'] as const;
const ANDROID_TARGET_SHEET_NAMES = ['Android Targets', 'Android'] as const;

interface ExcelProjectVariable {
    name: string;
    type: SupportedVariableType;
    value: string;
    masked?: boolean;
    group?: string | null;
}

interface ExcelFileEntry {
    filename: string;
    mimeType?: string;
    size?: number;
}

interface ExcelTargetEntry {
    id: string;
    config: BrowserConfig | TargetConfig;
}

export interface TestCaseExcelExportData {
    name?: string;
    testCaseId?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    projectVariables?: ExcelProjectVariable[];
    testCaseVariables?: ExcelProjectVariable[];
    files?: ExcelFileEntry[];
}

export interface ParsedTestCaseExcel {
    testCaseId?: string;
    testData: {
        name?: string;
        displayId?: string;
        url: string;
        prompt: string;
        steps?: TestStep[];
        browserConfig?: Record<string, BrowserConfig | TargetConfig>;
    };
    projectVariables: ExcelProjectVariable[];
    testCaseVariables: ExcelProjectVariable[];
    files: ExcelFileEntry[];
}

interface ParseResult {
    data: ParsedTestCaseExcel;
    warnings: string[];
}

export async function exportToExcelBuffer(data: TestCaseExcelExportData): Promise<Buffer> {
    const workbook = buildWorkbook(data);
    const output = await workbook.xlsx.writeBuffer();
    if (output instanceof ArrayBuffer) {
        return Buffer.from(output);
    }
    return Buffer.from(output);
}

export async function exportToExcelArrayBuffer(data: TestCaseExcelExportData): Promise<ArrayBuffer> {
    const workbook = buildWorkbook(data);
    const arrayOutput = await workbook.xlsx.writeBuffer();
    if (arrayOutput instanceof ArrayBuffer) {
        return arrayOutput;
    }
    const bytes = new Uint8Array(arrayOutput);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function parseTestCaseExcel(content: ArrayBuffer): Promise<ParseResult> {
    const warnings: string[] = [];
    const emptyData: ParsedTestCaseExcel = {
        testData: {
            url: '',
            prompt: '',
        },
        projectVariables: [],
        testCaseVariables: [],
        files: [],
    };

    let workbook: ExcelJS.Workbook;
    try {
        workbook = new ExcelJS.Workbook();
        const workbookInput = content as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0];
        await workbook.xlsx.load(workbookInput);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid Excel file';
        warnings.push(`Failed to parse Excel: ${errorMessage}`);
        return { data: emptyData, warnings };
    }

    const configurationsRows = readSheetRows(workbook, 'Configurations');
    const browserRows = readSheetRows(workbook, BROWSER_TARGET_SHEET_NAMES);
    const androidRows = readSheetRows(workbook, ANDROID_TARGET_SHEET_NAMES);
    const stepRows = readSheetRows(workbook, 'Test Steps');
    const parsedConfigurations = parseConfigurationsRows(configurationsRows, warnings);
    const parsedBrowserTargets = parseBrowserTargetRows(browserRows, warnings);
    const parsedAndroidTargets = parseAndroidTargetRows(androidRows, warnings);
    const hasDedicatedTargetSheets = browserRows.length > 0 || androidRows.length > 0;

    const parsedTestCase = parsedConfigurations.testCase;
    const targetEntries = hasDedicatedTargetSheets
        ? [...parsedBrowserTargets.targetEntries, ...parsedAndroidTargets.targetEntries]
        : parsedConfigurations.targetEntries;
    const targetAliases = hasDedicatedTargetSheets
        ? { ...parsedBrowserTargets.targetAliases, ...parsedAndroidTargets.targetAliases }
        : parsedConfigurations.targetAliases;
    const projectVariables = parsedConfigurations.projectVariables;
    const testCaseVariables = parsedConfigurations.testCaseVariables;
    const files = parsedConfigurations.files;

    const targetConfig: Record<string, BrowserConfig | TargetConfig> = {};
    targetEntries.forEach((entry) => {
        targetConfig[entry.id] = entry.config;
    });

    const firstBrowserEntry = targetEntries.find((entry) => !('type' in entry.config && entry.config.type === 'android'));
    const fallbackTargetId = targetEntries[0]?.id || 'browser_a';
    const validTargetIds = new Set(targetEntries.map((entry) => entry.id));
    const steps = parseStepRows(stepRows, validTargetIds, targetAliases, fallbackTargetId, warnings);

    return {
        data: {
            testCaseId: parsedTestCase.testCaseId,
            testData: {
                name: parsedTestCase.name,
                displayId: parsedTestCase.testCaseId,
                url: (firstBrowserEntry?.config as BrowserConfig | undefined)?.url || parsedTestCase.primaryUrl || '',
                prompt: '',
                steps: steps.length > 0 ? steps : undefined,
                browserConfig: Object.keys(targetConfig).length > 0 ? targetConfig : undefined,
            },
            projectVariables,
            testCaseVariables,
            files,
        },
        warnings,
    };
}

function buildWorkbook(data: TestCaseExcelExportData): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    const targetEntries = Object.entries(data.browserConfig || {}).map(([id, config]) => ({ id, config }));
    let browserTargetIndex = 0;
    let androidTargetIndex = 0;
    const targetLabelById = new Map<string, string>(
        targetEntries.map((entry) => {
            const isAndroid = 'type' in entry.config && entry.config.type === 'android';
            const label = formatTargetLabel(
                isAndroid ? androidTargetIndex++ : browserTargetIndex++,
                isAndroid ? 'android' : 'browser'
            );
            return [entry.id, label];
        })
    );
    const targetDisplayById = new Map(
        targetEntries.map((entry, index) => [
            entry.id,
            entry.config.name || targetLabelById.get(entry.id) || formatTargetLabel(index, 'browser')
        ])
    );

    const projectVariableRows = sortVariablesForExport(data.projectVariables || [])
        .filter((item) => item.type === 'URL' || item.type === 'APP_ID' || item.type === 'VARIABLE' || item.type === 'RANDOM_STRING' || item.type === 'FILE')
        .map((item) => ({
            Section: 'Project Variable',
            Type: formatConfigTypeForSheet(item.type),
            Name: item.name,
            Value: item.type === 'RANDOM_STRING' ? formatRandomStringValueForSheet(item.value) : item.value,
            Group: isGroupableConfigType(item.type) ? normalizeConfigGroup(item.group) : '',
            Masked: item.masked ? 'Y' : '',
        }));

    const testCaseVariableRows = sortVariablesForExport(data.testCaseVariables || [])
        .filter((item) => item.type === 'URL' || item.type === 'APP_ID' || item.type === 'VARIABLE' || item.type === 'RANDOM_STRING' || item.type === 'FILE')
        .map((item) => ({
            Section: 'Test Case Variable',
            Type: formatConfigTypeForSheet(item.type),
            Name: item.name,
            Value: item.type === 'RANDOM_STRING' ? formatRandomStringValueForSheet(item.value) : item.value,
            Group: isGroupableConfigType(item.type) ? normalizeConfigGroup(item.group) : '',
            Masked: item.masked ? 'Y' : '',
        }));

    const stepRows = (data.steps || []).map((step, index) => ({
        'Step No': index + 1,
        Browser: targetDisplayById.get(step.target) || step.target,
        Type: step.type === 'playwright-code' ? 'Code' : 'AI',
        Action: normalizeLineBreaks(step.action),
    }));

    const configurationsRows: Array<Record<string, string | number>> = [
        { Section: 'Basic Info', Type: 'Test Case Name', Name: data.name || '', Value: '' },
        { Section: 'Basic Info', Type: 'Test Case ID', Name: data.testCaseId || '', Value: '' },
        ...projectVariableRows,
        ...testCaseVariableRows,
    ];
    const browserTargetRows: Array<Record<string, string>> = targetEntries.flatMap((entry) => {
        if ('type' in entry.config && entry.config.type === 'android') {
            return [];
        }
        const normalizedBrowserConfig = normalizeBrowserConfig(entry.config as BrowserConfig);
        return [{
            Target: targetLabelById.get(entry.id) || entry.id,
            Name: normalizedBrowserConfig.name || '',
            URL: normalizedBrowserConfig.url || '',
            Width: String(normalizedBrowserConfig.width),
            Height: String(normalizedBrowserConfig.height),
        }];
    });
    const androidTargetRows: Array<Record<string, string>> = targetEntries.flatMap((entry) => {
        if (!('type' in entry.config && entry.config.type === 'android')) {
            return [];
        }
        const normalizedAndroidTarget = normalizeAndroidTargetConfig(entry.config);
        const deviceDisplay = formatAndroidDeviceSelectorDisplay(normalizedAndroidTarget.deviceSelector);
        return [{
            Target: targetLabelById.get(entry.id) || entry.id,
            Name: entry.config.name || '',
            Device: deviceDisplay.rawValue || '',
            'APP ID': entry.config.appId || '',
            'Clear App Data': entry.config.clearAppState ? 'Yes' : 'No',
            'Allow Permissions': entry.config.allowAllPermissions ? 'Yes' : 'No',
            'Device Details (separate by /)': [deviceDisplay.label, deviceDisplay.detail].filter(Boolean).join(' / '),
        }];
    });

    appendRowsAsWorksheet(workbook, 'Configurations', configurationsRows, ['Section', 'Type', 'Name', 'Value', 'Group', 'Masked']);
    if (browserTargetRows.length > 0) {
        appendRowsAsWorksheet(workbook, 'Browser Targets', browserTargetRows, ['Target', 'Name', 'URL', 'Width', 'Height']);
    }
    if (androidTargetRows.length > 0) {
        appendRowsAsWorksheet(
            workbook,
            'Android Targets',
            androidTargetRows,
            ['Target', 'Name', 'Device', 'APP ID', 'Clear App Data', 'Allow Permissions', 'Device Details (separate by /)']
        );
    }
    appendRowsAsWorksheet(workbook, 'Test Steps', stepRows);

    return workbook;
}

function appendRowsAsWorksheet(
    workbook: ExcelJS.Workbook,
    name: string,
    rows: Array<Record<string, string | number>>,
    headersOverride?: string[]
) {
    const worksheet = workbook.addWorksheet(name);
    const headers: string[] = headersOverride ? [...headersOverride] : [];
    if (!headersOverride) {
        const seen = new Set<string>();
        for (const row of rows) {
            for (const key of Object.keys(row)) {
                if (seen.has(key)) continue;
                seen.add(key);
                headers.push(key);
            }
        }
    }
    if (headers.length === 0) {
        return;
    }
    worksheet.addRow(headers);
    for (const row of rows) {
        worksheet.addRow(headers.map((header) => row[header] ?? ''));
    }
}

function parseConfigurationsRows(
    rows: Array<Record<string, unknown>>,
    warnings: string[]
): {
    testCase: { name?: string; testCaseId?: string; primaryUrl?: string };
    projectVariables: ExcelProjectVariable[];
    testCaseVariables: ExcelProjectVariable[];
    targetEntries: ExcelTargetEntry[];
    targetAliases: Record<string, string>;
    files: ExcelFileEntry[];
} {
    const fieldMap = new Map<string, string>();
    const projectVariables: ExcelProjectVariable[] = [];
    const testCaseVariables: ExcelProjectVariable[] = [];
    const targetEntries: ExcelTargetEntry[] = [];
    const targetAliases: Record<string, string> = {};
    const files: ExcelFileEntry[] = [];

    rows.forEach((row, index) => {
        const section = normalizeHeader(getRowValue(row, ['section']) || '');
        if (!section) {
            return;
        }

        if (section === 'basicinfo' || section === 'testcase') {
            const type = normalizeHeader(getRowValue(row, ['type']) || '');
            if (type === 'testcasename' || type === 'testcaseid' || type === 'primaryurl') {
                const value = getRowValue(row, ['name']) || '';
                if (type && value) fieldMap.set(type, value);
                return;
            }
            const key = normalizeHeader(getRowValue(row, ['key', 'name']) || '');
            const value = getRowValue(row, ['value']) || '';
            if (key) {
                fieldMap.set(key, value);
            }
            return;
        }

        if (section === 'projectvariable' || section === 'projectvariables'
            || section === 'testcasevariable' || section === 'testcasevariables') {
            const rawName = getRowValue(row, ['name', 'key']);
            const value = getRowValue(row, ['value']);
            const type = normalizeConfigType(getRowValue(row, ['type', 'config type']));
            const rawGroup = getRowValue(row, ['group']);
            const masked = parseMaskedCell(getRowValue(row, ['masked']));
            if (!rawName) {
                warnings.push(`Missing name in Configurations row ${index + 1}`);
                return;
            }
            if (!type) {
                warnings.push(`Invalid variable type in Configurations row ${index + 1}`);
                return;
            }
            if (type === 'FILE') {
                warnings.push(`file_type_skipped:${rawName.trim().toUpperCase()}`);
                return;
            }
            if (type === 'RANDOM_STRING') {
                const normalizedGenType = normalizeRandomStringValue(value);
                if (!normalizedGenType) {
                    warnings.push(`Invalid random string type in Configurations row ${index + 1}. Expected: Timestamp (Datetime), Timestamp (Unix), or UUID`);
                    return;
                }
                const name = rawName.trim().toUpperCase();
                const isProject = section === 'projectvariable' || section === 'projectvariables';
                const destination = isProject ? projectVariables : testCaseVariables;
                destination.push({
                    name,
                    type,
                    value: normalizedGenType,
                    group: isGroupableConfigType(type) ? (normalizeConfigGroup(rawGroup) || null) : null,
                    masked: false,
                });
                return;
            }
            if (!value) {
                warnings.push(`Missing value in Configurations row ${index + 1}`);
                return;
            }
            const name = rawName.trim().toUpperCase();
            const isProject = section === 'projectvariable' || section === 'projectvariables';
            const destination = isProject ? projectVariables : testCaseVariables;
            destination.push({
                name,
                type,
                value,
                group: isGroupableConfigType(type) ? (normalizeConfigGroup(rawGroup) || null) : null,
                masked: type === 'VARIABLE' ? masked : false,
            });
            return;
        }

        if (
            section === 'entrypoint'
            || section === 'entrypoints'
            || section === 'browserentrypoint'
            || section === 'browserentrypoints'
            || section === 'browser'
            || section === 'testingtarget'
            || section === 'testingtargets'
        ) {
            const type = normalizeHeader(getRowValue(row, ['type']) || '');
            if (type === 'browser') {
                const name = getRowValue(row, ['name', 'key']) || '';
                const url = getRowValue(row, ['value']) || '';
                if (url) {
                    const targetIndex = targetEntries.length;
                    const id = `browser_${String.fromCharCode('a'.charCodeAt(0) + targetIndex)}`;
                    targetEntries.push({
                        id,
                        config: normalizeBrowserConfig({
                            name: name || undefined,
                            url,
                            width: parseDimensionValue(getRowValue(row, ['width'])),
                            height: parseDimensionValue(getRowValue(row, ['height'])),
                        })
                    });
                    targetAliases[normalizeHeader(formatTargetLabel(targetIndex, 'browser'))] = id;
                    if (name) {
                        targetAliases[normalizeHeader(name)] = id;
                    }
                }
                return;
            }
            if (type === 'android') {
                const name = getRowValue(row, ['name', 'key']) || '';
                const rawDeviceValue = getRowValue(row, ['device', 'emulator', 'avd', 'avdname']) || '';
                const appId = getRowValue(row, ['value']) || '';
                const deviceSelector = rawDeviceValue.toLowerCase().startsWith('serial:')
                    ? { mode: 'connected-device' as const, serial: rawDeviceValue.slice('serial:'.length).trim() }
                    : { mode: 'emulator-profile' as const, emulatorProfileName: rawDeviceValue };
                if (appId || rawDeviceValue || name) {
                    const targetIndex = targetEntries.length;
                    const id = `android_${String.fromCharCode('a'.charCodeAt(0) + targetIndex)}`;
                    targetEntries.push({
                        id,
                        config: {
                            type: 'android',
                            name: name || undefined,
                            deviceSelector,
                            appId,
                            clearAppState: parseBooleanCell(getRowValue(row, ['clearappdata', 'clear app data']), true),
                            allowAllPermissions: parseBooleanCell(getRowValue(row, ['allowallpermissions', 'allow all permissions']), true),
                        }
                    });
                    targetAliases[normalizeHeader(formatTargetLabel(targetIndex, 'android'))] = id;
                    if (name) {
                        targetAliases[normalizeHeader(name)] = id;
                    }
                }
                return;
            }
            return;
        }

        if (section === 'file') {
            const filename = getRowValue(row, ['name', 'key', 'filename', 'file name']);
            if (!filename) {
                warnings.push(`Missing filename in Configurations row ${index + 1}`);
                return;
            }
            const sizeRaw = getRowValue(row, ['size']);
            const size = sizeRaw ? Number(sizeRaw) : undefined;
            files.push({
                filename,
                mimeType: getRowValue(row, ['mimetype', 'mime type', 'type']),
                size: Number.isFinite(size) ? size : undefined,
            });
        }
    });

    return {
        testCase: {
            name: fieldMap.get('testcasename') || fieldMap.get('name'),
            testCaseId: fieldMap.get('testcaseid'),
            primaryUrl: fieldMap.get('primaryurl'),
        },
        projectVariables,
        testCaseVariables,
        targetEntries,
        targetAliases,
        files,
    };
}

function parseBrowserTargetRows(
    rows: Array<Record<string, unknown>>,
    warnings: string[]
): {
    targetEntries: ExcelTargetEntry[];
    targetAliases: Record<string, string>;
} {
    const targetEntries: ExcelTargetEntry[] = [];
    const targetAliases: Record<string, string> = {};

    rows.forEach((row, index) => {
        const url = getRowValue(row, ['url', 'value']);
        const name = getRowValue(row, ['name', 'key']) || '';
        const width = parseDimensionValue(getRowValue(row, ['width']));
        const height = parseDimensionValue(getRowValue(row, ['height']));
        const rawTarget = getRowValue(row, ['target']);
        if (!url) {
            warnings.push(`Missing URL in Browsers row ${index + 1}`);
            return;
        }

        const targetIndex = targetEntries.length;
        const id = `browser_${String.fromCharCode('a'.charCodeAt(0) + targetIndex)}`;
        targetEntries.push({
            id,
            config: normalizeBrowserConfig({ name: name || undefined, url, width, height })
        });

        addTargetAlias(targetAliases, formatTargetLabel(targetIndex, 'browser'), id);
        addTargetAlias(targetAliases, rawTarget, id);
        addTargetAlias(targetAliases, name, id);
    });

    return { targetEntries, targetAliases };
}

function parseAndroidTargetRows(
    rows: Array<Record<string, unknown>>,
    warnings: string[]
): {
    targetEntries: ExcelTargetEntry[];
    targetAliases: Record<string, string>;
} {
    void warnings;
    const targetEntries: ExcelTargetEntry[] = [];
    const targetAliases: Record<string, string> = {};

    rows.forEach((row) => {
        const rawTarget = getRowValue(row, ['target']);
        const name = getRowValue(row, ['name', 'key']) || '';
        const rawDeviceValue = getRowValue(row, ['device', 'emulator', 'avd', 'avdname']) || '';
        const rawDeviceDetails = getRowValue(row, ['device details (separate by /)', 'device details', 'device detail']);
        const appId = getRowValue(row, ['app id', 'appid', 'value']) || '';

        if (!rawTarget && !name && !rawDeviceValue && !rawDeviceDetails && !appId) {
            return;
        }

        const targetIndex = targetEntries.length;
        const id = `android_${String.fromCharCode('a'.charCodeAt(0) + targetIndex)}`;
        targetEntries.push({
            id,
            config: {
                type: 'android',
                name: name || undefined,
                deviceSelector: parseAndroidDeviceSelectorForSheet(rawDeviceValue, rawDeviceDetails),
                appId,
                clearAppState: parseBooleanCell(getRowValue(row, ['clearappdata', 'clear app data']), true),
                allowAllPermissions: parseBooleanCell(getRowValue(row, ['allowpermissions', 'allow permissions', 'allowallpermissions', 'allow all permissions']), true),
            }
        });

        addTargetAlias(targetAliases, formatTargetLabel(targetIndex, 'android'), id);
        addTargetAlias(targetAliases, rawTarget, id);
        addTargetAlias(targetAliases, name, id);
    });

    return { targetEntries, targetAliases };
}

function addTargetAlias(targetAliases: Record<string, string>, alias: string | undefined, targetId: string) {
    if (!alias) return;
    const normalized = normalizeHeader(alias);
    if (!normalized) return;
    targetAliases[normalized] = targetId;
}

function parseAndroidDeviceSelectorForSheet(rawDeviceValue?: string, rawDeviceDetails?: string) {
    const detailHint = normalizeAndroidDeviceDetailHint(rawDeviceDetails);
    if (rawDeviceValue) {
        const trimmed = rawDeviceValue.trim();
        if (trimmed.toLowerCase().startsWith('serial:')) {
            return {
                mode: 'connected-device' as const,
                serial: trimmed.slice('serial:'.length).trim(),
            };
        }
        if (detailHint === 'connected-device') {
            return {
                mode: 'connected-device' as const,
                serial: trimmed,
            };
        }
        return {
            mode: 'emulator-profile' as const,
            emulatorProfileName: trimmed,
        };
    }

    const [deviceLabel = ''] = (rawDeviceDetails || '')
        .split('/')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    if (deviceLabel) {
        if (detailHint === 'connected-device') {
            return {
                mode: 'connected-device' as const,
                serial: deviceLabel.replace(/^serial:/i, '').trim(),
            };
        }
        if (deviceLabel.toLowerCase().startsWith('serial:')) {
            return {
                mode: 'connected-device' as const,
                serial: deviceLabel.slice('serial:'.length).trim(),
            };
        }
        return {
            mode: 'emulator-profile' as const,
            emulatorProfileName: deviceLabel,
        };
    }

    return {
        mode: 'emulator-profile' as const,
        emulatorProfileName: '',
    };
}

function normalizeAndroidDeviceDetailHint(value?: string): 'connected-device' | 'emulator-profile' | null {
    if (!value) return null;
    const normalized = normalizeHeader(value);
    if (normalized.includes('connecteddevice')) return 'connected-device';
    if (normalized.includes('emulatorprofile')) return 'emulator-profile';
    return null;
}

function readSheetRows(workbook: ExcelJS.Workbook, expectedNames: string | readonly string[]): Array<Record<string, unknown>> {
    const names = Array.isArray(expectedNames) ? expectedNames : [expectedNames];
    const normalizedNames = new Set(names.map(normalizeHeader));
    const worksheet = workbook.worksheets.find((sheet) => normalizedNames.has(normalizeHeader(sheet.name)));
    if (!worksheet) {
        return [];
    }

    return worksheetToRows(worksheet);
}

function worksheetToRows(worksheet: Worksheet): Array<Record<string, unknown>> {
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const primitive = extractCellValue(cell.value);
        headers[colNumber - 1] = primitive === undefined ? '' : String(primitive);
    });

    if (headers.every((header) => header.trim().length === 0)) {
        return [];
    }

    const rows: Array<Record<string, unknown>> = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        const record: Record<string, unknown> = {};
        let hasValue = false;

        headers.forEach((header, index) => {
            if (!header) {
                return;
            }
            const primitive = extractCellValue(row.getCell(index + 1).value);
            const value = primitive === undefined ? '' : primitive;
            record[header] = value;
            if (String(value).trim().length > 0) {
                hasValue = true;
            }
        });

        if (hasValue) {
            rows.push(record);
        }
    }

    return rows;
}

function extractCellValue(value: CellValue | undefined): string | number | boolean | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'object') {
        if ('result' in value) {
            return extractCellValue(value.result as CellValue);
        }
        if ('text' in value && typeof value.text === 'string') {
            return value.text;
        }
        if ('richText' in value && Array.isArray(value.richText)) {
            return value.richText.map((part) => part.text).join('');
        }
        if ('hyperlink' in value && typeof value.hyperlink === 'string') {
            return value.hyperlink;
        }
    }
    return undefined;
}

function parseStepRows(
    rows: Array<Record<string, unknown>>,
    validBrowserIds: Set<string>,
    browserAliases: Record<string, string>,
    fallbackTarget: string,
    warnings: string[]
): TestStep[] {
    return rows.flatMap((row, index) => {
        const action = getRowMultilineValue(row, ['action', 'step']);
        if (!action) {
            warnings.push(`Missing action in Test Steps row ${index + 1}`);
            return [];
        }

        const stepNo = parseStepNo(getRowValue(row, ['step no', 'step_no', 'no', 'id']), index + 1);
        const rawTarget = getRowValue(row, ['browser', 'target']) || fallbackTarget;
        const aliasTarget = browserAliases[normalizeHeader(rawTarget)];
        const resolvedTarget = aliasTarget || rawTarget;
        return [{
            id: String(stepNo),
            target: validBrowserIds.has(resolvedTarget) ? resolvedTarget : fallbackTarget,
            type: normalizeStepType(getRowValue(row, ['type'])),
            action: normalizeLineBreaks(action),
        }];
    });
}

function parseStepNo(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function normalizeStepType(value?: string): TestStep['type'] {
    if (!value) return 'ai-action';
    const normalized = value.trim().toLowerCase();
    if (normalized === 'code') {
        return 'playwright-code';
    }
    return 'ai-action';
}

function normalizeConfigType(value?: string): SupportedVariableType | null {
    if (!value) return null;
    const normalized = value.trim().toUpperCase().replace(/\s+/g, '_');
    if (normalized === 'URL' || normalized === 'APP_ID' || normalized === 'VARIABLE' || normalized === 'FILE') {
        return normalized;
    }
    if (normalized === 'APPID') return 'APP_ID';
    if (normalized === 'RANDOM_STRING' || normalized === 'RANDOMSTRING') {
        return 'RANDOM_STRING';
    }
    return null;
}

function normalizeRandomStringValue(value?: string): string | null {
    if (!value) return null;
    const normalized = value.trim().toUpperCase().replace(/[\s()]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (normalized === 'TIMESTAMP_UNIX' || normalized === 'TIMESTAMP_UNIX_') return 'TIMESTAMP_UNIX';
    if (normalized === 'TIMESTAMP_DATETIME' || normalized === 'TIMESTAMP_DATETIME_') return 'TIMESTAMP_DATETIME';
    if (normalized === 'UUID') return 'UUID';
    return null;
}

function formatRandomStringValueForSheet(value: string): string {
    switch (value) {
        case 'TIMESTAMP_UNIX': return 'Timestamp (Unix)';
        case 'TIMESTAMP_DATETIME': return 'Timestamp (Datetime)';
        case 'UUID': return 'UUID';
        default: return value;
    }
}

function formatConfigTypeForSheet(value: SupportedVariableType): string {
    if (value === 'URL') return 'URL';
    if (value === 'APP_ID') return 'AppID';
    if (value === 'VARIABLE') return 'Variable';
    if (value === 'RANDOM_STRING') return 'Random String';
    return 'File';
}

function sortVariablesForExport(items: ExcelProjectVariable[]): ExcelProjectVariable[] {
    return [...items].sort(compareByGroupThenName);
}

function formatBrowserLabel(index: number): string {
    return `Browser ${String.fromCharCode('A'.charCodeAt(0) + index)}`;
}

function formatAndroidLabel(index: number): string {
    return `Android ${String.fromCharCode('A'.charCodeAt(0) + index)}`;
}

function formatTargetLabel(index: number, type: 'browser' | 'android'): string {
    return type === 'android' ? formatAndroidLabel(index) : formatBrowserLabel(index);
}

function normalizeHeader(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseBooleanCell(value: string | undefined, defaultValue: boolean): boolean {
    if (!value) return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
    return defaultValue;
}

function parseMaskedCell(value: string | undefined): boolean {
    if (!value) return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes' || normalized === 'true' || normalized === '1';
}

function parseDimensionValue(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }
    return parsed;
}

function getRowValue(row: Record<string, unknown>, candidates: string[]): string | undefined {
    const normalizedCandidates = new Set(candidates.map(normalizeHeader));
    for (const [key, value] of Object.entries(row)) {
        if (!normalizedCandidates.has(normalizeHeader(key))) {
            continue;
        }
        const normalizedValue = normalizeCellValue(value);
        if (normalizedValue !== undefined) {
            return normalizedValue;
        }
    }
    return undefined;
}

function normalizeCellValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    return undefined;
}

function getRowMultilineValue(row: Record<string, unknown>, candidates: string[]): string | undefined {
    const normalizedCandidates = new Set(candidates.map(normalizeHeader));
    for (const [key, value] of Object.entries(row)) {
        if (!normalizedCandidates.has(normalizeHeader(key))) {
            continue;
        }
        if (typeof value === 'string') {
            return normalizeLineBreaks(value);
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
    }
    return undefined;
}

function normalizeLineBreaks(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

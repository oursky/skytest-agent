import ExcelJS, { CellValue, Worksheet } from 'exceljs';
import type { BrowserConfig, TargetConfig, ConfigType, TestStep } from '@/types';
import { normalizeAndroidTargetConfig } from '@/lib/android-target-config';

type SupportedVariableType = Extract<ConfigType, 'URL' | 'APP_ID' | 'VARIABLE' | 'SECRET' | 'RANDOM_STRING' | 'FILE'>;
const VARIABLE_TYPE_ORDER: SupportedVariableType[] = ['URL', 'APP_ID', 'VARIABLE', 'SECRET', 'FILE', 'RANDOM_STRING'];

interface ExcelProjectVariable {
    name: string;
    type: SupportedVariableType;
    value: string;
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
    const stepRows = readSheetRows(workbook, 'Test Steps');
    const parsedConfigurations = parseConfigurationsRows(configurationsRows, warnings);

    let parsedTestCase = parsedConfigurations.testCase;
    let targetEntries = parsedConfigurations.targetEntries;
    let targetAliases = parsedConfigurations.targetAliases;
    let projectVariables = parsedConfigurations.projectVariables;
    let testCaseVariables = parsedConfigurations.testCaseVariables;
    let files = parsedConfigurations.files;

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
    const targetDisplayById = new Map(
        targetEntries.map((entry, index) => [
            entry.id,
            entry.config.name || formatTargetLabel(index, 'type' in entry.config && entry.config.type === 'android' ? 'android' : 'browser')
        ])
    );

    const projectVariableRows = sortVariablesForExport(data.projectVariables || [])
        .filter((item) => item.type === 'URL' || item.type === 'APP_ID' || item.type === 'VARIABLE' || item.type === 'SECRET' || item.type === 'RANDOM_STRING' || item.type === 'FILE')
        .map((item) => ({
            Section: 'Project Variable',
            Type: formatConfigTypeForSheet(item.type),
            Name: item.name,
            Value: item.type === 'RANDOM_STRING' ? formatRandomStringValueForSheet(item.value) : item.value,
        }));

    const testCaseVariableRows = sortVariablesForExport(data.testCaseVariables || [])
        .filter((item) => item.type === 'URL' || item.type === 'APP_ID' || item.type === 'VARIABLE' || item.type === 'SECRET' || item.type === 'RANDOM_STRING' || item.type === 'FILE')
        .map((item) => ({
            Section: 'Test Case Variable',
            Type: formatConfigTypeForSheet(item.type),
            Name: item.name,
            Value: item.type === 'RANDOM_STRING' ? formatRandomStringValueForSheet(item.value) : item.value,
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
        ...targetEntries.map((entry) => {
            if ('type' in entry.config && entry.config.type === 'android') {
                const normalizedAndroidTarget = normalizeAndroidTargetConfig(entry.config);
                const deviceValue = normalizedAndroidTarget.deviceSelector.mode === 'connected-device'
                    ? `serial:${normalizedAndroidTarget.deviceSelector.serial}`
                    : normalizedAndroidTarget.deviceSelector.emulatorProfileName;
                return {
                    Section: 'Entry Point',
                    Type: 'Android',
                    Name: entry.config.name || '',
                    Value: entry.config.appId || '',
                    Device: deviceValue || '',
                    'Clear App Data': entry.config.clearAppState ? 'Yes' : 'No',
                    'Allow All Permissions': entry.config.allowAllPermissions ? 'Yes' : 'No',
                };
            }

            return {
                Section: 'Entry Point',
                Type: 'Browser',
                Name: entry.config.name || '',
                Value: (entry.config as BrowserConfig).url || '',
            };
        }),
    ];

    appendRowsAsWorksheet(workbook, 'Configurations', configurationsRows);
    appendRowsAsWorksheet(workbook, 'Test Steps', stepRows);

    return workbook;
}

function appendRowsAsWorksheet(
    workbook: ExcelJS.Workbook,
    name: string,
    rows: Array<Record<string, string | number>>
) {
    const worksheet = workbook.addWorksheet(name);
    if (rows.length === 0) {
        return;
    }

    const headers: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (seen.has(key)) continue;
            seen.add(key);
            headers.push(key);
        }
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
                destination.push({ name, type, value: normalizedGenType });
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
            });
            return;
        }

        if (section === 'entrypoint' || section === 'entrypoints' || section === 'browserentrypoint' || section === 'browserentrypoints' || section === 'browser') {
            const type = normalizeHeader(getRowValue(row, ['type']) || '');
            if (type === 'browser') {
                const name = getRowValue(row, ['name', 'key']) || '';
                const url = getRowValue(row, ['value']) || '';
                if (url) {
                    const targetIndex = targetEntries.length;
                    const id = `browser_${String.fromCharCode('a'.charCodeAt(0) + targetIndex)}`;
                    targetEntries.push({ id, config: { name: name || undefined, url } });
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

function readSheetRows(workbook: ExcelJS.Workbook, expectedName: string): Array<Record<string, unknown>> {
    const worksheet = workbook.worksheets.find((sheet) => normalizeHeader(sheet.name) === normalizeHeader(expectedName));
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
    if (normalized === 'URL' || normalized === 'APP_ID' || normalized === 'VARIABLE' || normalized === 'SECRET' || normalized === 'FILE') {
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
    if (value === 'SECRET') return 'Secret';
    if (value === 'RANDOM_STRING') return 'Random String';
    return 'File';
}

function sortVariablesForExport(items: ExcelProjectVariable[]): ExcelProjectVariable[] {
    return [...items].sort((a, b) => {
        const typeRankDiff = VARIABLE_TYPE_ORDER.indexOf(a.type) - VARIABLE_TYPE_ORDER.indexOf(b.type);
        if (typeRankDiff !== 0) return typeRankDiff;
        return a.name.localeCompare(b.name);
    });
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

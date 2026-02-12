import * as XLSX from 'xlsx';
import type { BrowserConfig, ConfigType, TestStep } from '@/types';

type SupportedVariableType = Extract<ConfigType, 'URL' | 'VARIABLE' | 'SECRET' | 'FILE'>;

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

export interface TestCaseExcelExportData {
    name?: string;
    testCaseId?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig>;
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
        browserConfig?: Record<string, BrowserConfig>;
    };
    projectVariables: ExcelProjectVariable[];
    testCaseVariables: ExcelProjectVariable[];
    files: ExcelFileEntry[];
}

interface ParseResult {
    data: ParsedTestCaseExcel;
    warnings: string[];
}

export function exportToExcelBuffer(data: TestCaseExcelExportData): Buffer {
    const workbook = buildWorkbook(data);
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}

export function exportToExcelArrayBuffer(data: TestCaseExcelExportData): ArrayBuffer {
    const workbook = buildWorkbook(data);
    const arrayOutput = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer | Uint8Array;
    if (arrayOutput instanceof ArrayBuffer) {
        return arrayOutput;
    }
    return new Uint8Array(arrayOutput).buffer;
}

export function parseTestCaseExcel(content: ArrayBuffer): ParseResult {
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

    let workbook: XLSX.WorkBook;
    try {
        workbook = XLSX.read(content, { type: 'array' });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Invalid Excel file';
        warnings.push(`Failed to parse Excel: ${errorMessage}`);
        return { data: emptyData, warnings };
    }

    const configurationsRows = readSheetRows(workbook, 'Configurations');
    const stepRows = readSheetRows(workbook, 'Test Steps');
    const parsedConfigurations = parseConfigurationsRows(configurationsRows, warnings);

    let parsedTestCase = parsedConfigurations.testCase;
    let browserEntries = parsedConfigurations.browserEntries;
    let browserAliases = parsedConfigurations.browserAliases;
    let projectVariables = parsedConfigurations.projectVariables;
    let testCaseVariables = parsedConfigurations.testCaseVariables;
    let files = parsedConfigurations.files;

    // Backward compatibility with older multi-sheet exports.
    if (configurationsRows.length === 0) {
        const testCaseRows = readSheetRows(workbook, 'Test Case');
        const variableRows = readSheetRows(workbook, 'Project Variables');
        const browserRows = readSheetRows(workbook, 'Browser Entry Points');
        const fileRows = readSheetRows(workbook, 'Files');
        parsedTestCase = parseTestCaseRows(testCaseRows);
        browserEntries = parseBrowserRows(browserRows, warnings);
        browserAliases = {};
        projectVariables = parseProjectVariableRows(variableRows, warnings);
        testCaseVariables = [];
        files = parseFileRows(fileRows, warnings);
    }

    const browserConfig: Record<string, BrowserConfig> = {};
    browserEntries.forEach((browser) => {
        browserConfig[browser.id] = {
            name: browser.name,
            url: browser.url,
        };
    });

    const fallbackBrowserId = browserEntries[0]?.id || 'browser_a';
    const validBrowserIds = new Set(browserEntries.map((browser) => browser.id));
    const steps = parseStepRows(stepRows, validBrowserIds, browserAliases, fallbackBrowserId, warnings);

    return {
        data: {
            testCaseId: parsedTestCase.testCaseId,
            testData: {
                name: parsedTestCase.name,
                displayId: parsedTestCase.testCaseId,
                url: browserEntries[0]?.url || parsedTestCase.primaryUrl || '',
                prompt: '',
                steps: steps.length > 0 ? steps : undefined,
                browserConfig: Object.keys(browserConfig).length > 0 ? browserConfig : undefined,
            },
            projectVariables,
            testCaseVariables,
            files,
        },
        warnings,
    };
}

function buildWorkbook(data: TestCaseExcelExportData): XLSX.WorkBook {
    const workbook = XLSX.utils.book_new();
    const browserEntries = Object.entries(data.browserConfig || {}).map(([id, config]) => ({
        id,
        name: config.name || '',
        url: config.url || '',
    }));
    const browserDisplayById = new Map(
        browserEntries.map((entry, index) => [entry.id, entry.name || formatBrowserLabel(index)])
    );

    const projectVariableRows = (data.projectVariables || [])
        .filter((item) => item.type === 'URL' || item.type === 'VARIABLE' || item.type === 'SECRET' || item.type === 'FILE')
        .map((item) => ({
            Section: 'Project Variable',
            Type: formatConfigTypeForSheet(item.type),
            Name: item.name,
            Value: item.value,
        }));

    const testCaseVariableRows = (data.testCaseVariables || [])
        .filter((item) => item.type === 'URL' || item.type === 'VARIABLE' || item.type === 'SECRET' || item.type === 'FILE')
        .map((item) => ({
            Section: 'Test Case Variable',
            Type: formatConfigTypeForSheet(item.type),
            Name: item.name,
            Value: item.value,
        }));

    const stepRows = (data.steps || []).map((step, index) => ({
        'Step No': index + 1,
        Browser: browserDisplayById.get(step.target) || step.target,
        Type: step.type === 'playwright-code' ? 'Code' : 'AI',
        Action: normalizeLineBreaks(step.action),
    }));

    const configurationsRows: Array<Record<string, string | number>> = [
        { Section: 'Basic Info', Type: 'Test Case Name', Name: data.name || '', Value: '' },
        { Section: 'Basic Info', Type: 'Test Case ID', Name: data.testCaseId || '', Value: '' },
        ...projectVariableRows,
        ...testCaseVariableRows,
        ...browserEntries.map((entry) => ({
            Section: 'Browser Entry Point',
            Type: 'Browser',
            Name: entry.name || '',
            Value: entry.url || '',
        })),
    ];

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(configurationsRows), 'Configurations');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(stepRows), 'Test Steps');

    return workbook;
}

function parseConfigurationsRows(
    rows: Array<Record<string, unknown>>,
    warnings: string[]
): {
    testCase: { name?: string; testCaseId?: string; primaryUrl?: string };
    projectVariables: ExcelProjectVariable[];
    testCaseVariables: ExcelProjectVariable[];
    browserEntries: Array<{ id: string; name?: string; url: string }>;
    browserAliases: Record<string, string>;
    files: ExcelFileEntry[];
} {
    const fieldMap = new Map<string, string>();
    const projectVariables: ExcelProjectVariable[] = [];
    const testCaseVariables: ExcelProjectVariable[] = [];
    const browserEntries: Array<{ id: string; name?: string; url: string }> = [];
    const browserEntryDrafts = new Map<string, { name?: string; url?: string }>();
    const browserAliases: Record<string, string> = {};
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

        if (section === 'browserentrypoint' || section === 'browserentrypoints' || section === 'browser') {
            // New format: 1 row per browser — Type = "Browser", Name = browser name, Value = URL
            const type = normalizeHeader(getRowValue(row, ['type']) || '');
            if (type === 'browser') {
                const name = getRowValue(row, ['name', 'key']) || '';
                const url = getRowValue(row, ['value']) || '';
                if (url) {
                    const id = `browser_${String.fromCharCode('a'.charCodeAt(0) + browserEntries.length)}`;
                    browserEntries.push({ id, name: name || undefined, url });
                    if (name) {
                        browserAliases[normalizeHeader(name)] = id;
                    }
                }
                return;
            }

            // Old format: 2 rows per browser — Type = "Browser A", Key = "Name"/"URL"
            const browserLabel = getRowValue(row, ['type']) || '';
            const key = normalizeHeader(getRowValue(row, ['key', 'name']) || '');
            const value = getRowValue(row, ['value']) || '';
            if (!browserLabel) {
                warnings.push(`Missing browser label in Configurations row ${index + 1}`);
                return;
            }
            if (!key) {
                warnings.push(`Missing browser key in Configurations row ${index + 1}`);
                return;
            }
            const entry = browserEntryDrafts.get(browserLabel) || {};
            if (key === 'name') {
                entry.name = value;
            } else if (key === 'url') {
                entry.url = value;
            }
            browserEntryDrafts.set(browserLabel, entry);
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

    // Process old-format browser drafts (2-row per browser)
    Array.from(browserEntryDrafts.entries()).forEach(([browserLabel, draft], index) => {
        if (!draft.url) {
            warnings.push(`Missing browser URL for ${browserLabel}`);
            return;
        }
        const id = browserLabelToId(browserLabel, index + browserEntries.length);
        browserEntries.push({
            id,
            name: draft.name,
            url: draft.url,
        });
        browserAliases[normalizeHeader(browserLabel)] = id;
        if (draft.name) {
            browserAliases[normalizeHeader(draft.name)] = id;
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
        browserEntries,
        browserAliases,
        files,
    };
}

function readSheetRows(workbook: XLSX.WorkBook, expectedName: string): Array<Record<string, unknown>> {
    const matchedSheetName = workbook.SheetNames.find((sheetName) => normalizeHeader(sheetName) === normalizeHeader(expectedName));
    if (!matchedSheetName) {
        return [];
    }

    const worksheet = workbook.Sheets[matchedSheetName];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' });
}

function parseTestCaseRows(rows: Array<Record<string, unknown>>): { name?: string; testCaseId?: string; primaryUrl?: string } {
    const fieldMap = new Map<string, string>();
    for (const row of rows) {
        const fieldName = getRowValue(row, ['field', 'key']);
        const fieldValue = getRowValue(row, ['value']);
        if (!fieldName || fieldValue === undefined) {
            continue;
        }
        fieldMap.set(normalizeHeader(fieldName), fieldValue);
    }

    const firstRow = rows[0];
    return {
        name: fieldMap.get('name') || getRowValue(firstRow || {}, ['name', 'test case name']),
        testCaseId: fieldMap.get('testcaseid') || getRowValue(firstRow || {}, ['test case id', 'testcaseid', 'id']),
        primaryUrl: fieldMap.get('primaryurl') || getRowValue(firstRow || {}, ['primary url', 'url']),
    };
}

function parseBrowserRows(rows: Array<Record<string, unknown>>, warnings: string[]): Array<{ id: string; name?: string; url: string }> {
    return rows.flatMap((row, index) => {
        const url = getRowValue(row, ['url', 'entry url']);
        if (!url) {
            warnings.push(`Missing URL in Browser Entry Points row ${index + 1}`);
            return [];
        }

        const rawId = getRowValue(row, ['id']) || `browser_${String.fromCharCode('a'.charCodeAt(0) + index)}`;
        return [{
            id: normalizeBrowserId(rawId, index),
            name: getRowValue(row, ['name']),
            url,
        }];
    });
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

function parseProjectVariableRows(rows: Array<Record<string, unknown>>, warnings: string[]): ExcelProjectVariable[] {
    return rows.flatMap((row, index) => {
        const rawName = getRowValue(row, ['name']);
        const type = normalizeConfigType(getRowValue(row, ['type']));
        const value = getRowValue(row, ['value']);

        if (!rawName) {
            warnings.push(`Missing name in Project Variables row ${index + 1}`);
            return [];
        }
        if (!type) {
            warnings.push(`Invalid type in Project Variables row ${index + 1}`);
            return [];
        }
        if (type === 'FILE') {
            warnings.push(`file_type_skipped:${rawName.trim().toUpperCase()}`);
            return [];
        }
        if (!value) {
            warnings.push(`Missing value in Project Variables row ${index + 1}`);
            return [];
        }

        return [{
            name: rawName.trim().toUpperCase(),
            type,
            value,
        }];
    });
}

function parseFileRows(rows: Array<Record<string, unknown>>, warnings: string[]): ExcelFileEntry[] {
    return rows.flatMap((row, index) => {
        const filename = getRowValue(row, ['filename', 'file name', 'name']);
        if (!filename) {
            warnings.push(`Missing filename in Files row ${index + 1}`);
            return [];
        }

        const sizeRaw = getRowValue(row, ['size']);
        const size = sizeRaw ? Number(sizeRaw) : undefined;
        return [{
            filename,
            mimeType: getRowValue(row, ['mimetype', 'mime type', 'type']),
            size: Number.isFinite(size) ? size : undefined,
        }];
    });
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
    const normalized = value.trim().toUpperCase();
    if (normalized === 'URL' || normalized === 'VARIABLE' || normalized === 'SECRET' || normalized === 'FILE') {
        return normalized;
    }
    return null;
}

function formatConfigTypeForSheet(value: SupportedVariableType): string {
    if (value === 'URL') return 'URL';
    if (value === 'VARIABLE') return 'Variable';
    if (value === 'SECRET') return 'Secret';
    return 'File';
}

function formatBrowserLabel(index: number): string {
    return `Browser ${String.fromCharCode('A'.charCodeAt(0) + index)}`;
}

function browserLabelToId(label: string, index: number): string {
    const match = label.trim().match(/^browser\s+([a-z])$/i);
    if (match) {
        return `browser_${match[1].toLowerCase()}`;
    }
    return `browser_${String.fromCharCode('a'.charCodeAt(0) + index)}`;
}

function normalizeBrowserId(value: string, index: number): string {
    const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return normalized || `browser_${String.fromCharCode('a'.charCodeAt(0) + index)}`;
}

function normalizeHeader(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
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

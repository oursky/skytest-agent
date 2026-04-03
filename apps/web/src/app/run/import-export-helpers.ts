import { exportToExcelArrayBuffer } from '@/utils/excel/testCaseExcel';
import type { BrowserConfig, ConfigItem, TargetConfig, TestCaseFile, TestStep } from '@/types';
import { buildExcelBaseName, downloadBlob, extractFileName, isSupportedVariableConfig } from './utils';

export interface RunPageTestData {
    url: string;
    prompt: string;
    name?: string;
    displayId?: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig | TargetConfig>;
}

export interface VariableConfigInput {
    name: string;
    type: 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING';
    value: string;
    masked?: boolean;
    group?: string | null;
}

export async function importVariablesToTestCaseHelper(input: {
    variables: VariableConfigInput[];
    sourceData: RunPageTestData;
    testCaseId: string | null;
    currentTestCaseId: string | null;
    refreshFilesTestCaseId: string | null;
    ensureTestCaseFromData: (data: RunPageTestData, options?: { suppressAlert?: boolean }) => Promise<string | null>;
    getAccessToken: () => Promise<string | undefined | null>;
    fetchTestCaseConfigs: (testCaseId: string) => Promise<void>;
}): Promise<string | null> {
    const {
        variables,
        sourceData,
        testCaseId,
        currentTestCaseId,
        refreshFilesTestCaseId,
        ensureTestCaseFromData,
        getAccessToken,
        fetchTestCaseConfigs,
    } = input;

    if (variables.length === 0) {
        return testCaseId || currentTestCaseId || refreshFilesTestCaseId || null;
    }

    let targetTestCaseId = testCaseId || currentTestCaseId || refreshFilesTestCaseId || null;
    if (!targetTestCaseId) {
        targetTestCaseId = await ensureTestCaseFromData(sourceData, { suppressAlert: true });
    }
    if (!targetTestCaseId) {
        return null;
    }

    const token = await getAccessToken();
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const jsonHeaders: HeadersInit = {
        'Content-Type': 'application/json',
        ...headers,
    };

    const existingResponse = await fetch(`/api/test-cases/${targetTestCaseId}/configs`, { headers });
    const existingConfigs: ConfigItem[] = existingResponse.ok ? await existingResponse.json() : [];
    const existingByName = new Map(existingConfigs.map((config) => [config.name, config]));

    for (const variable of variables) {
        const existing = existingByName.get(variable.name);
        try {
            if (!existing) {
                await fetch(`/api/test-cases/${targetTestCaseId}/configs`, {
                    method: 'POST',
                    headers: jsonHeaders,
                    body: JSON.stringify(variable),
                });
            } else {
                await fetch(`/api/test-cases/${targetTestCaseId}/configs/${existing.id}`, {
                    method: 'PUT',
                    headers: jsonHeaders,
                    body: JSON.stringify(variable),
                });
            }
        } catch {
            // silently skip failed variables
        }
    }

    await fetchTestCaseConfigs(targetTestCaseId);
    return targetTestCaseId;
}

export async function importVariablesToProjectHelper(input: {
    variables: VariableConfigInput[];
    projectId: string | null;
    projectIdFromTestCase: string | null;
    getAccessToken: () => Promise<string | undefined | null>;
    fetchProjectConfigs: (projectId: string) => Promise<void>;
}): Promise<void> {
    const {
        variables,
        projectId,
        projectIdFromTestCase,
        getAccessToken,
        fetchProjectConfigs,
    } = input;

    const targetProjectId = projectId || projectIdFromTestCase;
    if (!targetProjectId || variables.length === 0) {
        return;
    }

    const token = await getAccessToken();
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const jsonHeaders: HeadersInit = {
        'Content-Type': 'application/json',
        ...headers,
    };

    const existingResponse = await fetch(`/api/projects/${targetProjectId}/configs`, { headers });
    const existingConfigs: ConfigItem[] = existingResponse.ok ? await existingResponse.json() : [];
    const existingByName = new Map(existingConfigs.map((config) => [config.name, config]));

    for (const variable of variables) {
        const existing = existingByName.get(variable.name);
        try {
            if (!existing) {
                await fetch(`/api/projects/${targetProjectId}/configs`, {
                    method: 'POST',
                    headers: jsonHeaders,
                    body: JSON.stringify(variable),
                });
            } else {
                await fetch(`/api/projects/${targetProjectId}/configs/${existing.id}`, {
                    method: 'PUT',
                    headers: jsonHeaders,
                    body: JSON.stringify(variable),
                });
            }
        } catch {
            // silently skip failed variables
        }
    }

    await fetchProjectConfigs(targetProjectId);
}

export async function handleExportHelper(input: {
    data: RunPageTestData;
    testCaseId: string | null;
    currentTestCaseId: string | null;
    refreshFilesTestCaseId: string | null;
    isDirty: boolean;
    testCaseFiles: TestCaseFile[];
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
    projectId: string | null;
    projectIdFromTestCase: string | null;
    getAccessToken: () => Promise<string | undefined | null>;
}): Promise<void> {
    const {
        data,
        testCaseId,
        currentTestCaseId,
        refreshFilesTestCaseId,
        isDirty,
        testCaseFiles,
        projectConfigs,
        testCaseConfigs,
        projectId,
        projectIdFromTestCase,
        getAccessToken,
    } = input;

    const exportData: RunPageTestData = { ...data };
    const exportTestCaseId = testCaseId || currentTestCaseId || refreshFilesTestCaseId;

    const hasAttachedFilesInState = testCaseFiles.length > 0
        || projectConfigs.some((config) => config.type === 'FILE')
        || testCaseConfigs.some((config) => config.type === 'FILE');

    if (exportTestCaseId && (!isDirty || hasAttachedFilesInState)) {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
            const response = await fetch(`/api/test-cases/${exportTestCaseId}/export`, { headers });
            if (!response.ok) {
                throw new Error('Export request failed');
            }

            const blob = await response.blob();
            const filename = extractFileName(
                response.headers.get('Content-Disposition'),
                `${buildExcelBaseName(exportData.displayId, exportData.name)}.xlsx`
            );
            downloadBlob(blob, filename);
            return;
        } catch (error) {
            console.error('Failed to export from API, fallback to local Excel export', error);
        }
    }

    let exportProjectConfigs = projectConfigs;
    let exportTestCaseConfigs = testCaseConfigs;
    const exportProjectId = projectId || projectIdFromTestCase;

    if (exportProjectId || exportTestCaseId) {
        try {
            const token = await getAccessToken();
            const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

            const fetchConfigs = async (url: string): Promise<ConfigItem[] | null> => {
                const response = await fetch(url, { headers });
                if (!response.ok) {
                    return null;
                }
                return await response.json() as ConfigItem[];
            };

            const [latestProjectConfigs, latestTestCaseConfigs] = await Promise.all([
                exportProjectId
                    ? fetchConfigs(`/api/projects/${exportProjectId}/configs`)
                    : Promise.resolve(null),
                exportTestCaseId
                    ? fetchConfigs(`/api/test-cases/${exportTestCaseId}/configs`)
                    : Promise.resolve(null),
            ]);

            if (latestProjectConfigs) {
                exportProjectConfigs = latestProjectConfigs;
            }
            if (latestTestCaseConfigs) {
                exportTestCaseConfigs = latestTestCaseConfigs;
            }
        } catch (error) {
            console.error('Failed to fetch latest config values for export', error);
        }
    }

    const excelArrayBuffer = await exportToExcelArrayBuffer({
        name: exportData.name,
        testCaseId: exportData.displayId || undefined,
        steps: exportData.steps,
        browserConfig: exportData.browserConfig,
        projectVariables: exportProjectConfigs
            .filter(isSupportedVariableConfig)
            .map((config) => ({
                name: config.name,
                type: config.type,
                value: config.type === 'FILE' ? (config.filename || config.value) : config.value,
                masked: config.masked === true,
                group: config.group || null,
            })),
        testCaseVariables: exportTestCaseConfigs
            .filter(isSupportedVariableConfig)
            .map((config) => ({
                name: config.name,
                type: config.type,
                value: config.type === 'FILE' ? (config.filename || config.value) : config.value,
                masked: config.masked === true,
                group: config.group || null,
            })),
        files: testCaseFiles.map((file) => ({
            filename: file.filename,
            mimeType: file.mimeType,
            size: file.size,
        })),
    });

    const blob = new Blob([excelArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    downloadBlob(blob, `${buildExcelBaseName(exportData.displayId, exportData.name)}.xlsx`);
}

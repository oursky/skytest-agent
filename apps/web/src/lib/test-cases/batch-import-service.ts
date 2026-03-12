import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/core/prisma';
import { getTeamDevicesAvailability } from '@/lib/runners/availability-service';
import { cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import { normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { normalizeConfigName } from '@/lib/test-config/validation';
import { isGroupableConfigType, normalizeConfigGroup } from '@/lib/test-config/sort';
import { parseTestCaseExcel, type TestCaseExcelIssue } from '@/utils/excel/testCaseExcel';
import type {
    ConfigType,
    BrowserConfig,
    TargetConfig,
    AndroidTargetConfig,
    AndroidDeviceSelector,
} from '@/types';

type SupportedImportConfigType = Extract<ConfigType, 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING'>;

export type BatchImportMode = 'validate' | 'import-valid';
export type BatchImportIssueSeverity = 'warning' | 'error';
export type BatchImportFileStatus = 'valid' | 'invalid' | 'imported' | 'skipped';

export interface BatchImportIssue {
    code: string;
    severity: BatchImportIssueSeverity;
    reason: string;
    sheet?: string;
    row?: number;
    filename: string;
}

export interface BatchImportFileReport {
    filename: string;
    status: BatchImportFileStatus;
    testCaseName?: string;
    testCaseDisplayId?: string;
    existingTestCaseId?: string;
    importedTestCaseId?: string;
    issues: BatchImportIssue[];
}

export interface BatchImportSummary {
    totalFiles: number;
    validFiles: number;
    invalidFiles: number;
    warningFiles: number;
    importedFiles: number;
    skippedFiles: number;
}

export interface BatchImportResult {
    mode: BatchImportMode;
    summary: BatchImportSummary;
    files: BatchImportFileReport[];
}

export interface BatchImportSourceFile {
    filename: string;
    content: ArrayBuffer;
}

interface ParsedImportCandidate {
    filename: string;
    testCaseName?: string;
    testCaseDisplayId?: string;
    existingTestCaseId?: string;
    issues: BatchImportIssue[];
    parseData: Awaited<ReturnType<typeof parseTestCaseExcel>>['data'];
    hasErrors: boolean;
}

interface AndroidImportValidationContext {
    teamRunnerIds: Set<string>;
    runnerIdByDisplayId: Map<string, string>;
    teamDevices: Array<{
        runnerId: string;
        deviceId: string;
    }>;
}

interface UpsertConfigInput {
    name: string;
    type: SupportedImportConfigType;
    value: string;
    masked?: boolean;
    group?: string | null;
}

function mapParseIssue(fileName: string, issue: TestCaseExcelIssue): BatchImportIssue {
    return {
        code: issue.code,
        severity: issue.severity,
        reason: issue.reason,
        sheet: issue.sheet,
        row: issue.row,
        filename: fileName,
    };
}

function isSupportedImportConfigType(type: ConfigType): type is SupportedImportConfigType {
    return type === 'URL' || type === 'APP_ID' || type === 'VARIABLE' || type === 'RANDOM_STRING';
}

async function upsertProjectConfigs(
    tx: Prisma.TransactionClient,
    projectId: string,
    configs: UpsertConfigInput[]
): Promise<void> {
    for (const config of configs) {
        const name = normalizeConfigName(config.name);
        const type = config.type;
        const group = isGroupableConfigType(type) ? (normalizeConfigGroup(config.group) || null) : null;
        const masked = type === 'VARIABLE' ? config.masked === true : false;
        await tx.projectConfig.upsert({
            where: {
                projectId_name: {
                    projectId,
                    name,
                }
            },
            update: {
                type,
                value: config.value,
                masked,
                group,
            },
            create: {
                projectId,
                name,
                type,
                value: config.value,
                masked,
                group,
            },
        });
    }
}

async function upsertTestCaseConfigs(
    tx: Prisma.TransactionClient,
    testCaseId: string,
    configs: UpsertConfigInput[]
): Promise<void> {
    for (const config of configs) {
        const name = normalizeConfigName(config.name);
        const type = config.type;
        const group = isGroupableConfigType(type) ? (normalizeConfigGroup(config.group) || null) : null;
        const masked = type === 'VARIABLE' ? config.masked === true : false;
        await tx.testCaseConfig.upsert({
            where: {
                testCaseId_name: {
                    testCaseId,
                    name,
                }
            },
            update: {
                type,
                value: config.value,
                masked,
                group,
            },
            create: {
                testCaseId,
                name,
                type,
                value: config.value,
                masked,
                group,
            },
        });
    }
}

async function parseImportCandidate(
    projectId: string,
    file: BatchImportSourceFile,
    androidValidation: AndroidImportValidationContext
): Promise<ParsedImportCandidate> {
    const issues: BatchImportIssue[] = [];
    const parseResult = await parseTestCaseExcel(file.content);
    parseResult.issues.forEach((issue) => {
        issues.push(mapParseIssue(file.filename, issue));
    });

    const testCaseName = (parseResult.data.testData.name || '').trim();
    const testCaseDisplayId = (parseResult.data.testData.displayId || parseResult.data.testCaseId || '').trim();

    if (!testCaseName) {
        issues.push({
            code: 'MISSING_TEST_CASE_NAME',
            severity: 'error',
            reason: 'Test case name is required',
            filename: file.filename,
            sheet: 'Configurations',
        });
    }

    if (!testCaseDisplayId) {
        issues.push({
            code: 'MISSING_TEST_CASE_ID',
            severity: 'error',
            reason: 'Test case ID is required',
            filename: file.filename,
            sheet: 'Configurations',
        });
    }

    if (parseResult.data.testData.browserConfig) {
        const targetIssues = validateAndroidTargetBindings(
            parseResult.data.testData.browserConfig,
            androidValidation,
            file.filename
        );
        targetIssues.forEach((issue) => {
            issues.push(issue);
        });
    }

    let existingTestCaseId: string | undefined;
    if (testCaseName && testCaseDisplayId) {
        const matched = await prisma.testCase.findMany({
            where: {
                projectId,
                name: testCaseName,
                displayId: testCaseDisplayId,
            },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
        });
        if (matched.length > 1) {
            issues.push({
                code: 'AMBIGUOUS_TEST_CASE_MATCH',
                severity: 'error',
                reason: `Found multiple existing test cases with ID "${testCaseDisplayId}" and name "${testCaseName}"`,
                filename: file.filename,
                sheet: 'Configurations',
            });
        } else if (matched.length === 1) {
            existingTestCaseId = matched[0].id;
            issues.push({
                code: 'MATCHED_EXISTING_TEST_CASE',
                severity: 'warning',
                reason: `Found existing test case with ID "${testCaseDisplayId}" and name "${testCaseName}". Import will overwrite that test case if you continue.`,
                filename: file.filename,
                sheet: 'Configurations',
            });
        }
    }

    const hasErrors = issues.some((issue) => issue.severity === 'error');
    return {
        filename: file.filename,
        testCaseName: testCaseName || undefined,
        testCaseDisplayId: testCaseDisplayId || undefined,
        existingTestCaseId,
        issues,
        parseData: parseResult.data,
        hasErrors,
    };
}

function isAndroidTargetConfig(config: BrowserConfig | TargetConfig): config is AndroidTargetConfig {
    return 'type' in config && config.type === 'android';
}

const EMULATOR_PROFILE_DEVICE_PREFIX = 'emulator-profile:';

function buildRequestedDeviceId(selector: AndroidDeviceSelector): string {
    if (selector.mode === 'connected-device') {
        return selector.serial;
    }
    return `${EMULATOR_PROFILE_DEVICE_PREFIX}${selector.emulatorProfileName}`;
}

function resolveRunnerId(
    rawRunnerId: string,
    context: AndroidImportValidationContext
): string | null {
    const normalized = rawRunnerId.trim();
    if (!normalized) {
        return null;
    }

    if (context.teamRunnerIds.has(normalized)) {
        return normalized;
    }

    return context.runnerIdByDisplayId.get(normalized) ?? null;
}

function validateAndroidTargetBindings(
    browserConfig: Record<string, BrowserConfig | TargetConfig>,
    context: AndroidImportValidationContext,
    filename: string
): BatchImportIssue[] {
    const issues: BatchImportIssue[] = [];

    for (const [targetId, targetConfig] of Object.entries(browserConfig)) {
        if (!isAndroidTargetConfig(targetConfig)) {
            continue;
        }

        const normalizedTarget = normalizeAndroidTargetConfig(targetConfig);
        const requestedDeviceId = buildRequestedDeviceId(normalizedTarget.deviceSelector);
        const devicesForSelector = context.teamDevices.filter((device) => device.deviceId === requestedDeviceId);
        const targetLabel = normalizedTarget.name?.trim() || targetId;
        const requestedRunnerRaw = normalizedTarget.runnerScope?.runnerId?.trim() || '';

        if (!requestedRunnerRaw) {
            issues.push({
                code: 'ANDROID_RUNNER_REQUIRED',
                severity: 'error',
                reason: `Android target "${targetLabel}" requires Runner ID.`,
                filename,
                sheet: 'Android Targets',
            });
            continue;
        }

        const resolvedRunnerId = resolveRunnerId(requestedRunnerRaw, context);
        if (!resolvedRunnerId) {
            issues.push({
                code: 'ANDROID_RUNNER_NOT_FOUND',
                severity: 'error',
                reason: `Android target "${targetLabel}" uses Runner ID "${requestedRunnerRaw}" that is not paired to this team.`,
                filename,
                sheet: 'Android Targets',
            });
            continue;
        }

        targetConfig.runnerScope = { runnerId: resolvedRunnerId };
        const hasRunnerDeviceMatch = devicesForSelector.some((device) => device.runnerId === resolvedRunnerId);
        if (!hasRunnerDeviceMatch) {
            issues.push({
                code: 'ANDROID_RUNNER_DEVICE_MISMATCH',
                severity: 'error',
                reason: `Android target "${targetLabel}" requested device "${requestedDeviceId}" is not currently available on Runner ID "${requestedRunnerRaw}".`,
                filename,
                sheet: 'Android Targets',
            });
        }
    }

    return issues;
}

function summarize(
    mode: BatchImportMode,
    files: BatchImportFileReport[]
): BatchImportResult {
    const summary: BatchImportSummary = {
        totalFiles: files.length,
        validFiles: files.filter((item) => item.status === 'valid').length,
        invalidFiles: files.filter((item) => item.status === 'invalid').length,
        warningFiles: files.filter((item) => item.issues.some((issue) => issue.severity === 'warning')).length,
        importedFiles: files.filter((item) => item.status === 'imported').length,
        skippedFiles: files.filter((item) => item.status === 'skipped').length,
    };

    return {
        mode,
        summary,
        files,
    };
}

async function importCandidate(
    projectId: string,
    candidate: ParsedImportCandidate
): Promise<BatchImportFileReport> {
    if (candidate.hasErrors) {
        return {
            filename: candidate.filename,
            status: 'invalid',
            testCaseName: candidate.testCaseName,
            testCaseDisplayId: candidate.testCaseDisplayId,
            existingTestCaseId: candidate.existingTestCaseId,
            issues: candidate.issues,
        };
    }

    const testData = candidate.parseData.testData;
    const targetName = candidate.testCaseName || '';
    const targetDisplayId = candidate.testCaseDisplayId || '';
    const cleanedSteps = testData.steps ? cleanStepsForStorage(testData.steps) : undefined;
    const normalizedTargetConfig = testData.browserConfig
        ? normalizeTargetConfigMap(testData.browserConfig)
        : undefined;
    const projectVariables: UpsertConfigInput[] = candidate.parseData.projectVariables
        .filter((variable): variable is typeof variable & { type: SupportedImportConfigType } => isSupportedImportConfigType(variable.type))
        .map((variable) => ({
            name: variable.name,
            type: variable.type,
            value: variable.value,
            masked: variable.masked,
            group: variable.group || null,
        }));
    const testCaseVariables: UpsertConfigInput[] = candidate.parseData.testCaseVariables
        .filter((variable): variable is typeof variable & { type: SupportedImportConfigType } => isSupportedImportConfigType(variable.type))
        .map((variable) => ({
            name: variable.name,
            type: variable.type,
            value: variable.value,
            masked: variable.masked,
            group: variable.group || null,
        }));

    const importedTestCaseId = await prisma.$transaction(async (tx) => {
        let testCaseId = candidate.existingTestCaseId;
        if (testCaseId) {
            await tx.testCase.update({
                where: { id: testCaseId },
                data: {
                    name: targetName,
                    displayId: targetDisplayId,
                    url: testData.url || 'about:blank',
                    prompt: testData.prompt || '',
                    steps: cleanedSteps ? JSON.stringify(cleanedSteps) : null,
                    browserConfig: normalizedTargetConfig ? JSON.stringify(normalizedTargetConfig) : null,
                    status: 'DRAFT',
                },
            });
        } else {
            const created = await tx.testCase.create({
                data: {
                    projectId,
                    name: targetName,
                    displayId: targetDisplayId,
                    url: testData.url || 'about:blank',
                    prompt: testData.prompt || '',
                    steps: cleanedSteps ? JSON.stringify(cleanedSteps) : null,
                    browserConfig: normalizedTargetConfig ? JSON.stringify(normalizedTargetConfig) : null,
                    status: 'DRAFT',
                },
                select: { id: true },
            });
            testCaseId = created.id;
        }

        if (projectVariables.length > 0) {
            await upsertProjectConfigs(tx, projectId, projectVariables);
        }
        if (testCaseVariables.length > 0) {
            await upsertTestCaseConfigs(tx, testCaseId, testCaseVariables);
        }

        return testCaseId;
    });

    return {
        filename: candidate.filename,
        status: 'imported',
        testCaseName: candidate.testCaseName,
        testCaseDisplayId: candidate.testCaseDisplayId,
        existingTestCaseId: candidate.existingTestCaseId,
        importedTestCaseId,
        issues: candidate.issues,
    };
}

export async function processProjectBatchImport(input: {
    projectId: string;
    mode: BatchImportMode;
    files: BatchImportSourceFile[];
}): Promise<BatchImportResult> {
    const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { teamId: true },
    });
    if (!project) {
        throw new Error('Project not found');
    }

    const [teamDevicesAvailability, teamRunners] = await Promise.all([
        getTeamDevicesAvailability(project.teamId),
        prisma.runner.findMany({
            where: { teamId: project.teamId },
            select: {
                id: true,
                displayId: true,
            },
        }),
    ]);

    const runnerIdByDisplayId = new Map<string, string>();
    for (const runner of teamRunners) {
        const displayId = runner.displayId.trim();
        if (!displayId) {
            continue;
        }
        if (!runnerIdByDisplayId.has(displayId)) {
            runnerIdByDisplayId.set(displayId, runner.id);
        }
    }

    const androidValidationContext: AndroidImportValidationContext = {
        teamRunnerIds: new Set(teamRunners.map((runner) => runner.id)),
        runnerIdByDisplayId,
        teamDevices: teamDevicesAvailability.devices.map((device) => ({
            runnerId: device.runnerId,
            deviceId: device.deviceId,
        })),
    };

    const parsedCandidates = await Promise.all(
        input.files.map((file) => parseImportCandidate(input.projectId, file, androidValidationContext))
    );

    if (input.mode === 'validate') {
        const reports: BatchImportFileReport[] = parsedCandidates.map((candidate) => ({
            filename: candidate.filename,
            status: candidate.hasErrors ? 'invalid' : 'valid',
            testCaseName: candidate.testCaseName,
            testCaseDisplayId: candidate.testCaseDisplayId,
            existingTestCaseId: candidate.existingTestCaseId,
            issues: candidate.issues,
        }));
        return summarize(input.mode, reports);
    }

    const reports: BatchImportFileReport[] = [];
    for (const candidate of parsedCandidates) {
        if (candidate.hasErrors) {
            reports.push({
                filename: candidate.filename,
                status: 'skipped',
                testCaseName: candidate.testCaseName,
                testCaseDisplayId: candidate.testCaseDisplayId,
                existingTestCaseId: candidate.existingTestCaseId,
                issues: candidate.issues,
            });
            continue;
        }

        reports.push(await importCandidate(input.projectId, candidate));
    }

    return summarize(input.mode, reports);
}

import { Prisma } from '@prisma/client';
import path from 'path';
import { prisma } from '@/lib/core/prisma';
import { createLogger } from '@/lib/core/logger';
import { getTeamDevicesAvailability } from '@/lib/runners/availability-service';
import { cleanStepsForStorage, normalizeTargetConfigMap } from '@/lib/runtime/test-case-utils';
import { isAndroidTargetConfig, normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { buildEmulatorProfileRequestedDeviceId } from '@/lib/android/target-requests';
import { normalizeConfigName } from '@/lib/test-config/validation';
import {
    validateAndSanitizeFile,
    buildTestCaseFileObjectKey,
    buildProjectConfigObjectKey,
    buildTestCaseConfigObjectKey,
} from '@/lib/security/file-security';
import { putObjectBuffer } from '@/lib/storage/object-store-utils';
import { parseTestCaseExcel, type TestCaseExcelIssue } from '@/utils/excel/testCaseExcel';
import {
    TEST_STATUS,
    TEST_CASE_KIND,
    type ConfigType,
    type BrowserConfig,
    type TargetConfig,
    type AndroidTargetConfig,
} from '@/types';

const logger = createLogger('lib:test-cases:batch-import');

type SupportedImportConfigType = Extract<ConfigType, 'URL' | 'APP_ID' | 'VARIABLE' | 'RANDOM_STRING'>;

export type BatchImportMode = 'validate' | 'import-valid' | 'import-all-draft';
export type BatchImportIssueSeverity = 'info' | 'warning' | 'error';
export type BatchImportFileStatus = 'complete' | 'incomplete' | 'invalid' | 'imported' | 'skipped';

// Issues that make a test case impossible to create even as an incomplete draft.
// Everything else is a warning the user can resolve later (or pick at run time),
// except the purely informational overwrite notice.
const ERROR_ISSUE_CODES = new Set<string>([
    'INVALID_EXCEL',
    'MISSING_TEST_CASE_NAME',
    'AMBIGUOUS_TEST_CASE_MATCH',
]);
const INFO_ISSUE_CODES = new Set<string>([
    'MATCHED_EXISTING_TEST_CASE',
]);

function classifyIssueSeverity(code: string): BatchImportIssueSeverity {
    if (ERROR_ISSUE_CODES.has(code)) {
        return 'error';
    }
    if (INFO_ISSUE_CODES.has(code)) {
        return 'info';
    }
    return 'warning';
}

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
    completeFiles: number;
    incompleteFiles: number;
    invalidFiles: number;
    importedFiles: number;
    skippedFiles: number;
}

export interface BatchImportResult {
    mode: BatchImportMode;
    summary: BatchImportSummary;
    files: BatchImportFileReport[];
}

export interface BatchImportAttachment {
    filename: string;
    content: Buffer;
}

export interface BatchImportSourceFile {
    filename: string;
    content: ArrayBuffer;
    attachments?: BatchImportAttachment[];
    configFiles?: BatchImportAttachment[];
}

interface ParsedImportCandidate {
    filename: string;
    testCaseName?: string;
    testCaseDisplayId?: string;
    kind: string;
    existingTestCaseId?: string;
    issues: BatchImportIssue[];
    parseData: Awaited<ReturnType<typeof parseTestCaseExcel>>['data'];
    attachments: BatchImportAttachment[];
    configFiles: BatchImportAttachment[];
    hasErrors: boolean;
    isComplete: boolean;
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
            },
            create: {
                projectId,
                name,
                type,
                value: config.value,
                masked,
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
            },
            create: {
                testCaseId,
                name,
                type,
                value: config.value,
                masked,
            },
        });
    }
}

function normalizeKind(rawKind?: string): string {
    return (rawKind || '').trim().toUpperCase() === TEST_CASE_KIND.LOGIN_FLOW
        ? TEST_CASE_KIND.LOGIN_FLOW
        : TEST_CASE_KIND.TEST;
}

async function parseImportCandidate(
    projectId: string,
    file: BatchImportSourceFile,
    androidValidation: AndroidImportValidationContext,
    providedProjectConfigNames: Set<string>
): Promise<ParsedImportCandidate> {
    const issues: BatchImportIssue[] = [];
    const parseResult = await parseTestCaseExcel(file.content);
    const attachments = file.attachments ?? [];
    const configFiles = file.configFiles ?? [];
    const providedAttachmentNames = new Set(attachments.map((attachment) => attachment.filename.toLowerCase()));
    const providedConfigFileNames = new Set([
        ...configFiles.map((configFile) => configFile.filename.toLowerCase()),
        ...providedProjectConfigNames,
    ]);

    parseResult.issues.forEach((issue) => {
        // The zip carries file content, so the "upload manually" warnings no longer
        // apply to attachments or FILE variables that are present in the archive.
        if (issue.code === 'FILE_ATTACHMENT_MANUAL_UPLOAD_REQUIRED'
            && issue.filename
            && providedAttachmentNames.has(issue.filename.toLowerCase())) {
            return;
        }
        if (issue.code === 'FILE_VARIABLE_NOT_IMPORTABLE'
            && issue.filename
            && providedConfigFileNames.has(issue.filename.toLowerCase())) {
            return;
        }
        issues.push(mapParseIssue(file.filename, issue));
    });

    const testCaseName = (parseResult.data.testData.name || '').trim();
    const testCaseDisplayId = (parseResult.data.testData.displayId || parseResult.data.testCaseId || '').trim();
    const kind = normalizeKind(parseResult.data.testData.kind);

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
            severity: 'warning',
            reason: 'Test case ID is missing; it can be set after import.',
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
                severity: 'info',
                reason: `Found existing test case with ID "${testCaseDisplayId}" and name "${testCaseName}". Import will overwrite that test case if you continue.`,
                filename: file.filename,
                sheet: 'Configurations',
            });
        }
    }

    return {
        filename: file.filename,
        testCaseName: testCaseName || undefined,
        testCaseDisplayId: testCaseDisplayId || undefined,
        kind,
        existingTestCaseId,
        issues,
        parseData: parseResult.data,
        attachments,
        configFiles,
        hasErrors: false,
        isComplete: false,
    };
}

// Adds warnings for login flow references that cannot be matched to a known test
// case (in the import batch or already in the project), then normalizes severities
// and computes the completeness flags used to drive each import mode.
function finalizeCandidate(candidate: ParsedImportCandidate, knownDisplayIds: Set<string>): void {
    const browserConfig = candidate.parseData.testData.browserConfig ?? {};
    for (const [targetId, targetConfig] of Object.entries(browserConfig)) {
        if (isAndroidTargetConfig(targetConfig)) {
            continue;
        }
        const loginFlowRef = (targetConfig as BrowserConfig).loginFlowId?.trim();
        if (loginFlowRef && !knownDisplayIds.has(loginFlowRef)) {
            const targetLabel = (targetConfig as BrowserConfig).name?.trim() || targetId;
            candidate.issues.push({
                code: 'LOGIN_FLOW_NOT_FOUND',
                severity: 'warning',
                reason: `Login flow "${loginFlowRef}" referenced by target "${targetLabel}" was not found. It will be cleared; select a login flow at run time.`,
                filename: candidate.filename,
                sheet: 'Browser Targets',
            });
        }
    }

    candidate.issues.forEach((issue) => {
        issue.severity = classifyIssueSeverity(issue.code);
    });
    candidate.hasErrors = candidate.issues.some((issue) => issue.severity === 'error');
    candidate.isComplete = !candidate.hasErrors
        && !candidate.issues.some((issue) => issue.severity === 'warning');
}

function buildRequestedDeviceId(selector: AndroidTargetConfig['deviceSelector']): string {
    if (selector.mode === 'connected-device') {
        return selector.serial;
    }
    return buildEmulatorProfileRequestedDeviceId(selector.emulatorProfileName);
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
                severity: 'warning',
                reason: `Android target "${targetLabel}" has no Runner ID; select a device/runner at run time.`,
                filename,
                sheet: 'Android Targets',
            });
            continue;
        }

        const resolvedRunnerId = resolveRunnerId(requestedRunnerRaw, context);
        if (!resolvedRunnerId) {
            issues.push({
                code: 'ANDROID_RUNNER_NOT_FOUND',
                severity: 'warning',
                reason: `Android target "${targetLabel}" uses Runner ID "${requestedRunnerRaw}" that is not paired to this team; select a device/runner at run time.`,
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
                severity: 'warning',
                reason: `Android target "${targetLabel}" requested device "${requestedDeviceId}" is not currently available on Runner ID "${requestedRunnerRaw}"; select a device at run time.`,
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
        completeFiles: files.filter((item) => item.status === 'complete').length,
        incompleteFiles: files.filter((item) => item.status === 'incomplete').length,
        invalidFiles: files.filter((item) => item.status === 'invalid').length,
        importedFiles: files.filter((item) => item.status === 'imported').length,
        skippedFiles: files.filter((item) => item.status === 'skipped').length,
    };

    return {
        mode,
        summary,
        files,
    };
}

function resolveLoginFlowReferences(
    browserConfig: Record<string, BrowserConfig | TargetConfig>,
    displayIdToId: Map<string, string>,
    candidate: ParsedImportCandidate,
    resultIssues: BatchImportIssue[]
): void {
    for (const targetConfig of Object.values(browserConfig)) {
        if (isAndroidTargetConfig(targetConfig)) {
            continue;
        }
        const browser = targetConfig as BrowserConfig;
        const loginFlowRef = browser.loginFlowId?.trim();
        if (!loginFlowRef) {
            continue;
        }
        const resolvedId = displayIdToId.get(loginFlowRef);
        if (resolvedId) {
            browser.loginFlowId = resolvedId;
        } else {
            delete browser.loginFlowId;
            if (!resultIssues.some((issue) => issue.code === 'LOGIN_FLOW_NOT_FOUND')) {
                resultIssues.push({
                    code: 'LOGIN_FLOW_NOT_FOUND',
                    severity: 'warning',
                    reason: `Login flow "${loginFlowRef}" was not found and was cleared; select a login flow at run time.`,
                    filename: candidate.filename,
                    sheet: 'Browser Targets',
                });
            }
        }
    }
}

async function restoreAttachments(
    testCaseId: string,
    candidate: ParsedImportCandidate,
    resultIssues: BatchImportIssue[]
): Promise<void> {
    if (candidate.attachments.length === 0) {
        return;
    }

    const metaByName = new Map(
        candidate.parseData.files.map((file) => [file.filename.toLowerCase(), file])
    );
    const existing = await prisma.testCaseFile.findMany({
        where: { testCaseId },
        select: { filename: true },
    });
    const existingNames = new Set(existing.map((file) => file.filename));

    for (const attachment of candidate.attachments) {
        if (existingNames.has(attachment.filename)) {
            continue;
        }
        const meta = metaByName.get(attachment.filename.toLowerCase());
        const mimeType = meta?.mimeType || 'application/octet-stream';
        const validation = validateAndSanitizeFile(attachment.filename, mimeType, attachment.content.length);
        if (!validation.valid) {
            resultIssues.push({
                code: 'ATTACHMENT_RESTORE_SKIPPED',
                severity: 'warning',
                reason: `Attachment "${attachment.filename}" was not restored: ${validation.error ?? 'invalid file'}. Upload it manually.`,
                filename: candidate.filename,
            });
            continue;
        }

        try {
            const objectKey = buildTestCaseFileObjectKey(testCaseId, validation.storedName!);
            await putObjectBuffer({ key: objectKey, body: attachment.content, contentType: mimeType });
            await prisma.testCaseFile.create({
                data: {
                    testCaseId,
                    filename: validation.sanitizedFilename ?? path.basename(attachment.filename),
                    storedName: objectKey,
                    mimeType,
                    size: attachment.content.length,
                },
            });
            existingNames.add(attachment.filename);
        } catch (error) {
            logger.warn('Failed to restore attachment during import', { filename: attachment.filename, error });
            resultIssues.push({
                code: 'ATTACHMENT_RESTORE_FAILED',
                severity: 'warning',
                reason: `Attachment "${attachment.filename}" could not be restored; upload it manually.`,
                filename: candidate.filename,
            });
        }
    }
}

async function restoreFileConfigs(input: {
    projectId: string;
    testCaseId: string;
    candidate: ParsedImportCandidate;
    projectConfigContentByName: Map<string, Buffer>;
    restoredProjectConfigNames: Set<string>;
    resultIssues: BatchImportIssue[];
}): Promise<void> {
    const { projectId, testCaseId, candidate, projectConfigContentByName, restoredProjectConfigNames, resultIssues } = input;

    const caseConfigContentByName = new Map(
        candidate.configFiles.map((file) => [file.filename.toLowerCase(), file.content])
    );

    const restore = async (
        scope: 'project' | 'testCase',
        variable: { name: string; value: string; filename?: string; mimeType?: string },
        content: Buffer
    ): Promise<void> => {
        const displayName = variable.filename || variable.value || variable.name;
        const mimeType = variable.mimeType || 'application/octet-stream';
        const validation = validateAndSanitizeFile(displayName, mimeType, content.length);
        if (!validation.valid) {
            resultIssues.push({
                code: 'CONFIG_FILE_RESTORE_SKIPPED',
                severity: 'warning',
                reason: `File variable "${variable.name}" was not restored: ${validation.error ?? 'invalid file'}. Upload it manually.`,
                filename: candidate.filename,
            });
            return;
        }
        try {
            const objectKey = scope === 'project'
                ? buildProjectConfigObjectKey(projectId, validation.storedName!)
                : buildTestCaseConfigObjectKey(testCaseId, validation.storedName!);
            await putObjectBuffer({ key: objectKey, body: content, contentType: mimeType });
            const data = {
                type: 'FILE' as const,
                value: objectKey,
                masked: false,
                filename: validation.sanitizedFilename ?? displayName,
                mimeType,
                size: content.length,
            };
            const name = normalizeConfigName(variable.name);
            if (scope === 'project') {
                await prisma.projectConfig.upsert({
                    where: { projectId_name: { projectId, name } },
                    update: data,
                    create: { projectId, name, ...data },
                });
            } else {
                await prisma.testCaseConfig.upsert({
                    where: { testCaseId_name: { testCaseId, name } },
                    update: data,
                    create: { testCaseId, name, ...data },
                });
            }
        } catch (error) {
            logger.warn('Failed to restore file variable during import', { name: variable.name, error });
            resultIssues.push({
                code: 'CONFIG_FILE_RESTORE_FAILED',
                severity: 'warning',
                reason: `File variable "${variable.name}" could not be restored; upload it manually.`,
                filename: candidate.filename,
            });
        }
    };

    for (const variable of candidate.parseData.testCaseVariables) {
        if (variable.type !== 'FILE') {
            continue;
        }
        const content = caseConfigContentByName.get((variable.filename || variable.value || '').toLowerCase());
        if (content) {
            await restore('testCase', variable, content);
        }
    }

    for (const variable of candidate.parseData.projectVariables) {
        if (variable.type !== 'FILE') {
            continue;
        }
        const name = normalizeConfigName(variable.name);
        if (restoredProjectConfigNames.has(name)) {
            continue;
        }
        const content = projectConfigContentByName.get((variable.filename || variable.value || '').toLowerCase());
        if (content) {
            restoredProjectConfigNames.add(name);
            await restore('project', variable, content);
        }
    }
}

async function importCandidate(
    projectId: string,
    candidate: ParsedImportCandidate,
    displayIdToId: Map<string, string>,
    projectConfigContentByName: Map<string, Buffer>,
    restoredProjectConfigNames: Set<string>
): Promise<BatchImportFileReport> {
    const testData = candidate.parseData.testData;
    const targetName = candidate.testCaseName || '';
    const targetDisplayId = candidate.testCaseDisplayId || '';
    const resultIssues: BatchImportIssue[] = [...candidate.issues];
    const cleanedSteps = testData.steps ? cleanStepsForStorage(testData.steps) : undefined;
    const normalizedTargetConfig = testData.browserConfig
        ? normalizeTargetConfigMap(testData.browserConfig)
        : undefined;
    if (normalizedTargetConfig) {
        resolveLoginFlowReferences(normalizedTargetConfig, displayIdToId, candidate, resultIssues);
    }
    const projectVariables: UpsertConfigInput[] = candidate.parseData.projectVariables
        .filter((variable): variable is typeof variable & { type: SupportedImportConfigType } => isSupportedImportConfigType(variable.type))
        .map((variable) => ({
            name: variable.name,
            type: variable.type,
            value: variable.value,
            masked: variable.masked,
        }));
    const testCaseVariables: UpsertConfigInput[] = candidate.parseData.testCaseVariables
        .filter((variable): variable is typeof variable & { type: SupportedImportConfigType } => isSupportedImportConfigType(variable.type))
        .map((variable) => ({
            name: variable.name,
            type: variable.type,
            value: variable.value,
            masked: variable.masked,
        }));

    const importedTestCaseId = await prisma.$transaction(async (tx) => {
        let testCaseId = candidate.existingTestCaseId;
        if (testCaseId) {
            await tx.testCase.update({
                where: { id: testCaseId },
                data: {
                    name: targetName,
                    displayId: targetDisplayId || null,
                    kind: candidate.kind,
                    url: testData.url || 'about:blank',
                    prompt: testData.prompt || '',
                    steps: cleanedSteps ? JSON.stringify(cleanedSteps) : null,
                    browserConfig: normalizedTargetConfig ? JSON.stringify(normalizedTargetConfig) : null,
                    status: TEST_STATUS.DRAFT,
                },
            });
        } else {
            const created = await tx.testCase.create({
                data: {
                    projectId,
                    name: targetName,
                    displayId: targetDisplayId || null,
                    kind: candidate.kind,
                    url: testData.url || 'about:blank',
                    prompt: testData.prompt || '',
                    steps: cleanedSteps ? JSON.stringify(cleanedSteps) : null,
                    browserConfig: normalizedTargetConfig ? JSON.stringify(normalizedTargetConfig) : null,
                    status: TEST_STATUS.DRAFT,
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

    await restoreAttachments(importedTestCaseId, candidate, resultIssues);
    await restoreFileConfigs({
        projectId,
        testCaseId: importedTestCaseId,
        candidate,
        projectConfigContentByName,
        restoredProjectConfigNames,
        resultIssues,
    });

    if (targetDisplayId) {
        displayIdToId.set(targetDisplayId, importedTestCaseId);
    }

    return {
        filename: candidate.filename,
        status: 'imported',
        testCaseName: candidate.testCaseName,
        testCaseDisplayId: candidate.testCaseDisplayId,
        existingTestCaseId: candidate.existingTestCaseId,
        importedTestCaseId,
        issues: resultIssues,
    };
}

export async function processProjectBatchImport(input: {
    projectId: string;
    mode: BatchImportMode;
    files: BatchImportSourceFile[];
    projectConfigFiles?: BatchImportAttachment[];
}): Promise<BatchImportResult> {
    const project = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { teamId: true },
    });
    if (!project) {
        throw new Error('Project not found');
    }

    const [teamDevicesAvailability, teamRunners, projectTestCases] = await Promise.all([
        getTeamDevicesAvailability(project.teamId),
        prisma.runner.findMany({
            where: { teamId: project.teamId },
            select: { id: true, displayId: true },
        }),
        prisma.testCase.findMany({
            where: { projectId: input.projectId, displayId: { not: null } },
            select: { id: true, displayId: true },
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

    const projectConfigFiles = input.projectConfigFiles ?? [];
    const projectConfigContentByName = new Map(
        projectConfigFiles.map((file) => [file.filename.toLowerCase(), file.content])
    );
    const providedProjectConfigNames = new Set(projectConfigContentByName.keys());

    const parsedCandidates = await Promise.all(
        input.files.map((file) => parseImportCandidate(input.projectId, file, androidValidationContext, providedProjectConfigNames))
    );

    const displayIdToId = new Map<string, string>();
    for (const testCase of projectTestCases) {
        if (testCase.displayId) {
            displayIdToId.set(testCase.displayId, testCase.id);
        }
    }
    const knownDisplayIds = new Set<string>(displayIdToId.keys());
    for (const candidate of parsedCandidates) {
        if (candidate.testCaseDisplayId) {
            knownDisplayIds.add(candidate.testCaseDisplayId);
        }
    }
    parsedCandidates.forEach((candidate) => finalizeCandidate(candidate, knownDisplayIds));

    if (input.mode === 'validate') {
        const reports: BatchImportFileReport[] = parsedCandidates.map((candidate) => ({
            filename: candidate.filename,
            status: candidate.hasErrors ? 'invalid' : (candidate.isComplete ? 'complete' : 'incomplete'),
            testCaseName: candidate.testCaseName,
            testCaseDisplayId: candidate.testCaseDisplayId,
            existingTestCaseId: candidate.existingTestCaseId,
            issues: candidate.issues,
        }));
        return summarize(input.mode, reports);
    }

    const shouldImport = (candidate: ParsedImportCandidate): boolean => {
        if (candidate.hasErrors) {
            return false;
        }
        return input.mode === 'import-all-draft' ? true : candidate.isComplete;
    };

    // Import login flows first so test cases that reference them in the same batch
    // can resolve their links against freshly created ids.
    const ordered = [...parsedCandidates].sort((a, b) => {
        const aLogin = a.kind === TEST_CASE_KIND.LOGIN_FLOW ? 0 : 1;
        const bLogin = b.kind === TEST_CASE_KIND.LOGIN_FLOW ? 0 : 1;
        return aLogin - bLogin;
    });

    const restoredProjectConfigNames = new Set<string>();
    const reports: BatchImportFileReport[] = [];
    for (const candidate of ordered) {
        if (!shouldImport(candidate)) {
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

        reports.push(await importCandidate(
            input.projectId,
            candidate,
            displayIdToId,
            projectConfigContentByName,
            restoredProjectConfigNames
        ));
    }

    return summarize(input.mode, reports);
}

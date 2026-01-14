import { chromium, Page, BrowserContext, Browser, FilePayload } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import { TestStep, BrowserConfig, TestEvent, TestResult, RunTestOptions, TestCaseFile } from '@/types';
import { config } from '@/config/app';
import { ConfigurationError, BrowserError, TestExecutionError, PlaywrightCodeError, getErrorMessage } from './errors';
import { getFilePath } from './file-security';
import { validateTargetUrl } from './url-security';
import { Script, createContext } from 'node:vm';
import path from 'node:path';

export const maxDuration = config.test.maxDuration;

type EventHandler = (event: TestEvent) => void;

const credentialPlaceholders = config.test.security.credentialPlaceholders;

type InputFilesParam = Parameters<Page['setInputFiles']>[1];

type FilePayloadWithPath = FilePayload & { path: string };

function applyAgentGuardrails(instruction: string): string {
    const guardrails = config.test.security.agentGuardrails.trim();
    if (!guardrails) return instruction;
    return `${guardrails}\n\nTask:\n${instruction}`;
}

function applyCredentialPlaceholders(instruction: string, browserConfig?: BrowserConfig): string {
    const usernamePlaceholder = credentialPlaceholders.username;
    const passwordPlaceholder = credentialPlaceholders.password;
    const hasUsernamePlaceholder = instruction.includes(usernamePlaceholder);
    const hasPasswordPlaceholder = instruction.includes(passwordPlaceholder);

    if (hasUsernamePlaceholder && !browserConfig?.username) {
        throw new ConfigurationError('Username placeholder used but no username provided', 'username');
    }

    if (hasPasswordPlaceholder && !browserConfig?.password) {
        throw new ConfigurationError('Password placeholder used but no password provided', 'password');
    }

    let output = instruction;
    if (hasUsernamePlaceholder) {
        output = output.split(usernamePlaceholder).join(browserConfig?.username ?? '');
    }
    if (hasPasswordPlaceholder) {
        output = output.split(passwordPlaceholder).join(browserConfig?.password ?? '');
    }

    return output;
}

function validateTargetConfigs(targetConfigs: Record<string, BrowserConfig>) {
    for (const [browserId, browserConfig] of Object.entries(targetConfigs)) {
        if (!browserConfig.url) continue;
        const result = validateTargetUrl(browserConfig.url);
        if (!result.valid) {
            const reason = result.error ? `: ${result.error}` : '';
            throw new ConfigurationError(`Invalid URL for ${browserId}${reason}`, 'url');
        }
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validatePlaywrightCode(code: string, stepIndex: number) {
    for (const token of config.test.security.playwrightCodeBlockedTokens) {
        const regex = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
        if (regex.test(code)) {
            throw new PlaywrightCodeError(
                `Unsafe token "${token}" is not allowed in Playwright code`,
                stepIndex,
                code
            );
        }
    }
}

function normalizeUploadPath(filePath: string, stepIndex: number, code: string): string {
    const uploadRoot = path.resolve(process.cwd(), config.files.uploadDir);
    const resolved = path.resolve(process.cwd(), filePath);
    const prefix = uploadRoot.endsWith(path.sep) ? uploadRoot : `${uploadRoot}${path.sep}`;

    if (!resolved.startsWith(prefix)) {
        throw new PlaywrightCodeError(
            'Only files uploaded for this test case can be used with setInputFiles',
            stepIndex,
            code
        );
    }

    return resolved;
}

function hasFilePath(value: unknown): value is FilePayloadWithPath {
    if (!value || typeof value !== 'object') return false;
    if (!('path' in value)) return false;
    const pathValue = (value as { path?: unknown }).path;
    return typeof pathValue === 'string' && pathValue.length > 0;
}

function sanitizeInputFiles(files: InputFilesParam, stepIndex: number, code: string): InputFilesParam {
    if (typeof files === 'string') {
        return normalizeUploadPath(files, stepIndex, code);
    }

    if (Array.isArray(files)) {
        return files.map((file) => {
            if (typeof file === 'string') {
                return normalizeUploadPath(file, stepIndex, code);
            }
            if (hasFilePath(file)) {
                return { ...file, path: normalizeUploadPath(file.path, stepIndex, code) };
            }
            return file;
        }) as InputFilesParam;
    }

    if (hasFilePath(files)) {
        return { ...files, path: normalizeUploadPath(files.path, stepIndex, code) } as InputFilesParam;
    }

    return files;
}

function createSafePage(page: Page, stepIndex: number, code: string): Page {
    return new Proxy(page, {
        get(target, prop) {
            if (prop === 'setInputFiles') {
                return async (...args: Parameters<Page['setInputFiles']>) => {
                    const [selector, files, options] = args;
                    const sanitizedFiles = sanitizeInputFiles(files, stepIndex, code);
                    return target.setInputFiles(selector, sanitizedFiles, options);
                };
            }

            const value = Reflect.get(target, prop) as unknown;
            if (typeof value === 'function') {
                return (value as (...args: unknown[]) => unknown).bind(target);
            }
            return value;
        }
    }) as Page;
}

interface BrowserInstances {
    browser: Browser;
    contexts: Map<string, BrowserContext>;
    pages: Map<string, Page>;
    agents: Map<string, PlaywrightAgent>;
}

function createLogger(onEvent: EventHandler) {
    return (msg: string, type: 'info' | 'error' | 'success' = 'info', browserId?: string) => {
        onEvent({
            type: 'log',
            data: { message: msg, level: type },
            browserId,
            timestamp: Date.now()
        });
    };
}

async function captureScreenshot(
    page: Page,
    label: string,
    onEvent: EventHandler,
    log: ReturnType<typeof createLogger>,
    browserId?: string
) {
    try {
        if (page.isClosed()) return;
        const buffer = await page.screenshot({
            type: config.test.screenshot.type,
            quality: config.test.screenshot.quality
        });
        const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
        onEvent({
            type: 'screenshot',
            data: { src: base64, label },
            browserId,
            timestamp: Date.now()
        });
    } catch (e) {
        log(`Failed to capture screenshot: ${getErrorMessage(e)}`, 'error', browserId);
    }
}

function validateConfiguration(
    url: string,
    prompt: string,
    steps: TestStep[] | undefined,
    browserConfig: Record<string, BrowserConfig> | undefined
): Record<string, BrowserConfig> {
    const hasBrowserConfig = browserConfig && Object.keys(browserConfig).length > 0;

    let targetConfigs: Record<string, BrowserConfig> = {};
    if (hasBrowserConfig) {
        targetConfigs = browserConfig;
    } else if (url) {
        targetConfigs = { 'main': { url, username: undefined, password: undefined } };
    } else {
        throw new ConfigurationError('Valid configuration (URL or BrowserConfig) is required');
    }

    const hasSteps = steps && steps.length > 0;
    const hasPrompt = !!prompt;

    if (!hasSteps && !hasPrompt) {
        throw new ConfigurationError('Instructions (Prompt or Steps) are required');
    }

    validateTargetConfigs(targetConfigs);

    return targetConfigs;
}

function getBrowserNiceName(browserId: string): string {
    return browserId === 'main' ? 'Browser' : browserId.replace('browser_', 'Browser ').toUpperCase();
}

interface ActionCounter {
    count: number;
}

async function setupBrowserInstances(
    targetConfigs: Record<string, BrowserConfig>,
    onEvent: EventHandler,
    signal?: AbortSignal,
    actionCounter?: ActionCounter
): Promise<BrowserInstances> {
    const log = createLogger(onEvent);

    log('Launching browser...', 'info');
    const browser = await chromium.launch({
        headless: true,
        timeout: config.test.browser.timeout,
        args: config.test.browser.args
    });
    log('Browser launched successfully', 'success');

    const contexts = new Map<string, BrowserContext>();
    const pages = new Map<string, Page>();
    const agents = new Map<string, PlaywrightAgent>();

    const browserIds = Object.keys(targetConfigs);

    for (const browserId of browserIds) {
        if (signal?.aborted) break;

        const browserConfig = targetConfigs[browserId];
        const niceName = getBrowserNiceName(browserId);

        log(`Initializing ${niceName}...`, 'info', browserId);

        const context = await browser.newContext({
            viewport: config.test.browser.viewport
        });

        const page = await context.newPage();
        page.on('console', async (msg: any) => {
            const type = msg.type();
            if (type === 'log' || type === 'info') {
                if (!msg.text().includes('[midscene]')) {
                    log(`[${niceName}] ${msg.text()}`, 'info', browserId);
                }
            } else if (type === 'error') {
                log(`[${niceName} Error] ${msg.text()}`, 'error', browserId);
            }
        });

        contexts.set(browserId, context);
        pages.set(browserId, page);

        if (browserConfig.url) {
            log(`[${niceName}] Navigating to ${browserConfig.url}...`, 'info', browserId);
            await page.goto(browserConfig.url, {
                timeout: config.test.browser.timeout,
                waitUntil: 'domcontentloaded'
            });
            await captureScreenshot(page, `[${niceName}] Initial Page Load`, onEvent, log, browserId);
        }

        const agent = new PlaywrightAgent(page, {
            onTaskStartTip: async (tip) => {
                if (actionCounter) {
                    actionCounter.count++;
                    console.log(`[Usage] Action counted: ${actionCounter.count} - ${tip}`);
                }
                log(`[${niceName}] 🤖 ${tip}`, 'info', browserId);
                if (page && !page.isClosed()) {
                    await captureScreenshot(page, `[${niceName}] ${tip}`, onEvent, log, browserId);
                }
            }
        });
        agents.set(browserId, agent);
    }

    log('All browser instances ready', 'success');

    return { browser, contexts, pages, agents };
}

function parseCodeIntoStatements(code: string): string[] {
    const statements: string[] = [];
    const lines = code.split('\n');
    let currentStatement = '';

    for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('//')) {
            continue;
        }

        if (currentStatement) {
            currentStatement += '\n' + line;
        } else {
            currentStatement = line;
        }

        const openParens = (currentStatement.match(/\(/g) || []).length;
        const closeParens = (currentStatement.match(/\)/g) || []).length;
        const isComplete = openParens === closeParens &&
            (trimmed.endsWith(';') || trimmed.endsWith(')'));

        if (isComplete) {
            statements.push(currentStatement.trim());
            currentStatement = '';
        }
    }

    if (currentStatement.trim()) {
        statements.push(currentStatement.trim());
    }

    return statements;
}

async function executePlaywrightCode(
    code: string,
    page: Page,
    stepIndex: number,
    log: ReturnType<typeof createLogger>,
    onEvent: EventHandler,
    browserId?: string
): Promise<void> {
    const timeoutMs = 30000;
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
    const niceName = getBrowserNiceName(browserId || 'main');

    try {
        new AsyncFunction('page', code);
    } catch (syntaxError) {
        throw new PlaywrightCodeError(
            `Syntax error in code at step ${stepIndex + 1}: ${getErrorMessage(syntaxError)}`,
            stepIndex,
            code,
            syntaxError instanceof Error ? syntaxError : undefined
        );
    }

    validatePlaywrightCode(code, stepIndex);

    const statements = parseCodeIntoStatements(code);

    if (statements.length === 0) {
        log(`[Step ${stepIndex + 1}] No executable statements found`, 'info', browserId);
        return;
    }

    const safePage = createSafePage(page, stepIndex, code);
    const context = createContext({ page: safePage });

    log(`[Step ${stepIndex + 1}] Executing ${statements.length} statement(s)...`, 'info', browserId);

    for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        const statementPreview = statement.length > 80 ? statement.substring(0, 80) + '...' : statement;

        log(`[Step ${stepIndex + 1}.${i + 1}] ${statementPreview}`, 'info', browserId);

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Statement execution timed out (30s): ${statementPreview}`)), timeoutMs);
        });

        try {
            const script = new Script(`(async () => { ${statement} })()`);
            const result = script.runInContext(context) as Promise<unknown>;
            await Promise.race([result, timeoutPromise]);
        } catch (error) {
            throw new PlaywrightCodeError(
                `Playwright code execution failed at step ${stepIndex + 1}.${i + 1}: ${getErrorMessage(error)}`,
                stepIndex,
                statement,
                error instanceof Error ? error : undefined
            );
        }

        await captureScreenshot(
            page,
            `[${niceName}] Step ${stepIndex + 1}.${i + 1}: ${statementPreview}`,
            onEvent,
            log,
            browserId
        );
    }
}

function resolveFilePaths(
    step: TestStep,
    testCaseId: string | undefined,
    files: TestCaseFile[] | undefined
): string[] {
    if (!step.files || step.files.length === 0 || !testCaseId || !files) {
        return [];
    }

    return step.files
        .map(fileId => {
            const file = files.find(f => f.id === fileId);
            if (!file) return null;
            return getFilePath(testCaseId, file.storedName);
        })
        .filter((p): p is string => p !== null);
}

async function executeSteps(
    steps: TestStep[],
    browserInstances: BrowserInstances,
    targetConfigs: Record<string, BrowserConfig>,
    onEvent: EventHandler,
    signal?: AbortSignal,
    testCaseId?: string,
    files?: TestCaseFile[]
): Promise<void> {
    const log = createLogger(onEvent);
    const { pages, agents } = browserInstances;
    const browserIds = Object.keys(targetConfigs);

    for (let i = 0; i < steps.length; i++) {
        if (signal?.aborted) throw new Error('Aborted');

        const step = steps[i];
        const effectiveTargetId = step.target || browserIds[0];
        const stepType = step.type || 'ai-action';

        const agent = agents.get(effectiveTargetId);
        const page = pages.get(effectiveTargetId);
        const browserConfig = targetConfigs[effectiveTargetId];
        const niceName = getBrowserNiceName(effectiveTargetId);

        try {
            if (!page) {
                throw new TestExecutionError(
                    `Browser instance '${effectiveTargetId}' not found for step: ${step.action}`,
                    '',
                    step.action
                );
            }

            if (stepType === 'playwright-code') {
                await executePlaywrightCode(step.action, page, i, log, onEvent, effectiveTargetId);
            } else {
                if (!agent) {
                    throw new TestExecutionError(
                        `Browser agent '${effectiveTargetId}' not found for AI step: ${step.action}`,
                        '',
                        step.action
                    );
                }

                log(`[Step ${i + 1}] Executing AI action on ${niceName}: ${step.action}`, 'info', effectiveTargetId);

                const stepAction = applyCredentialPlaceholders(step.action, browserConfig);
                const guardedAction = applyAgentGuardrails(stepAction);

                await agent.aiAct(guardedAction);
                await captureScreenshot(page, `[${niceName}] Step ${i + 1} Complete`, onEvent, log, effectiveTargetId);
            }
        } catch (e) {
            const msg = getErrorMessage(e);
            log(`[Step ${i + 1}] Error: ${msg}`, 'error', effectiveTargetId);
            throw e;
        }
    }
}

async function executePrompt(
    prompt: string,
    browserInstances: BrowserInstances,
    targetConfigs: Record<string, BrowserConfig>
): Promise<void> {
    const { agents } = browserInstances;
    const browserIds = Object.keys(targetConfigs);
    const targetId = browserIds[0];
    const agent = agents.get(targetId);
    const browserConfig = targetConfigs[targetId];

    if (!agent) {
        throw new TestExecutionError('No browser agent available', '');
    }

    const promptWithCredentials = applyCredentialPlaceholders(prompt, browserConfig);
    const guardedPrompt = applyAgentGuardrails(promptWithCredentials);

    await agent.aiAct(guardedPrompt);
}

async function captureFinalScreenshots(
    browserInstances: BrowserInstances,
    onEvent: EventHandler,
    signal?: AbortSignal
): Promise<void> {
    const log = createLogger(onEvent);
    const { pages } = browserInstances;

    for (const [id, page] of pages) {
        if (signal?.aborted) break;
        const niceName = getBrowserNiceName(id);
        if (!page.isClosed()) {
            await captureScreenshot(page, `[${niceName}] Final State`, onEvent, log, id);
        }
    }
}

async function captureErrorScreenshots(
    browserInstances: BrowserInstances,
    onEvent: EventHandler
): Promise<void> {
    const log = createLogger(onEvent);
    const { pages } = browserInstances;

    try {
        for (const [id, page] of pages) {
            if (!page.isClosed()) {
                await captureScreenshot(page, `Error State [${id}]`, onEvent, log, id);
            }
        }
    } catch (e) {
        console.error('Failed to capture error screenshot', e);
    }
}

async function cleanup(browser: Browser): Promise<void> {
    try {
        if (browser) await browser.close();
    } catch (e) {
        console.error('Error closing browser:', e);
    }
}

export async function runTest(options: RunTestOptions): Promise<TestResult> {
    const { config: testConfig, onEvent, signal, runId, onCleanup } = options;
    const { url, username, password, prompt, steps, browserConfig, openRouterApiKey, testCaseId, files } = testConfig;
    const log = createLogger(onEvent);

    if (!openRouterApiKey) {
        return { status: 'FAIL', error: 'OpenRouter API key is required. Please configure it in API Key & Usage settings.' };
    }

    process.env.MIDSCENE_MODEL_API_KEY = openRouterApiKey;
    process.env.MIDSCENE_PLANNING_MODEL_API_KEY = openRouterApiKey;
    process.env.MIDSCENE_INSIGHT_MODEL_API_KEY = openRouterApiKey;

    const targetConfigs = validateConfiguration(url, prompt, steps, browserConfig);
    const hasSteps = steps && steps.length > 0;

    let browserInstances: BrowserInstances | null = null;
    const actionCounter: ActionCounter = { count: 0 };

    try {
        browserInstances = await setupBrowserInstances(targetConfigs, onEvent, signal, actionCounter);

        if (onCleanup && browserInstances) {
            onCleanup(async () => {
                if (browserInstances?.browser) {
                    await browserInstances.browser.close().catch(() => { });
                }
            });
        }

        log('Executing test...', 'info');

        if (signal?.aborted) throw new Error('Aborted');

        if (hasSteps) {
            await executeSteps(steps!, browserInstances, targetConfigs, onEvent, signal, testCaseId, files);
        } else {
            await executePrompt(prompt, browserInstances, targetConfigs);
        }

        if (signal?.aborted) throw new Error('Aborted');

        log('✅ Test executed successfully', 'success');

        await captureFinalScreenshots(browserInstances, onEvent, signal);

        return { status: 'PASS', actionCount: actionCounter.count };

    } catch (error: unknown) {
        if (signal?.aborted || (error instanceof Error && error.message === 'Aborted')) {
            return { status: 'CANCELLED', error: 'Test was cancelled by user', actionCount: actionCounter.count };
        }

        const msg = getErrorMessage(error);
        log(`Critical System Error: ${msg}`, 'error');

        if (browserInstances) {
            await captureErrorScreenshots(browserInstances, onEvent);
        }

        return { status: 'FAIL', error: msg, actionCount: actionCounter.count };

    } finally {
        if (browserInstances) {
            await cleanup(browserInstances.browser);
        }
    }
}

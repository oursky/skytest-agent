import { chromium, Page, BrowserContext, Browser } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import { TestStep, BrowserConfig, TestEvent, TestResult, RunTestOptions } from '@/types';
import { config } from '@/config/app';
import { ConfigurationError, BrowserError, TestExecutionError, getErrorMessage } from './errors';

export const maxDuration = config.test.maxDuration;

type EventHandler = (event: TestEvent) => void;

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

async function executeSteps(
    steps: TestStep[],
    browserInstances: BrowserInstances,
    targetConfigs: Record<string, BrowserConfig>,
    onEvent: EventHandler,
    signal?: AbortSignal
): Promise<void> {
    const log = createLogger(onEvent);
    const { pages, agents } = browserInstances;
    const browserIds = Object.keys(targetConfigs);

    for (let i = 0; i < steps.length; i++) {
        if (signal?.aborted) throw new Error('Aborted');

        const step = steps[i];
        const effectiveTargetId = step.target || browserIds[0];

        const agent = agents.get(effectiveTargetId);
        const page = pages.get(effectiveTargetId);
        const browserConfig = targetConfigs[effectiveTargetId];
        const niceName = getBrowserNiceName(effectiveTargetId);

        if (!agent || !page) {
            throw new TestExecutionError(
                `Browser instance '${effectiveTargetId}' not found for step: ${step.action}`,
                '',
                step.action
            );
        }

        log(`[Step ${i + 1}] Executing on ${niceName}: ${step.action}`, 'info', effectiveTargetId);

        let stepAction = step.action;
        if (browserConfig && (browserConfig.username || browserConfig.password)) {
            stepAction += `\n(Credentials: ${browserConfig.username} / ${browserConfig.password})`;
        }

        await agent.aiAct(stepAction);
        await captureScreenshot(page, `[${niceName}] Step ${i + 1} Complete`, onEvent, log, effectiveTargetId);
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

    let fullPrompt = prompt;
    if (browserConfig.username || browserConfig.password) {
        fullPrompt += `\n\nCredentials if needed:\nUsername: ${browserConfig.username}\nPassword: ${browserConfig.password}`;
    }

    await agent.aiAct(fullPrompt);
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
    const { url, username, password, prompt, steps, browserConfig, openRouterApiKey } = testConfig;
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

        // Register cleanup so cancel can force-close browser
        if (onCleanup && browserInstances) {
            onCleanup(async () => {
                if (browserInstances?.browser) {
                    await browserInstances.browser.close().catch(() => {});
                }
            });
        }

        log('Executing test...', 'info');

        if (signal?.aborted) throw new Error('Aborted');

        if (hasSteps) {
            await executeSteps(steps!, browserInstances, targetConfigs, onEvent, signal);
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

import { NextResponse } from 'next/server';
import { chromium, Page, BrowserContext } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';
import { TestStep, BrowserConfig } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes timeout

// Helper to encode data for streaming
function encodeEvent(data: unknown) {
    return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
    const { url, username, password, prompt, steps, browserConfig } = await request.json();

    // Determine configuration mode
    // Mode 1: Multi-Browser (browserConfig present)
    // Mode 2: Legacy Single (url/prompt present)

    // Normalize to a map of configs
    let targetConfigs: Record<string, BrowserConfig> = {};

    if (browserConfig && Object.keys(browserConfig).length > 0) {
        targetConfigs = browserConfig;
    } else if (url) {
        // Fallback to single 'main' browser
        targetConfigs = {
            'main': { url, username, password }
        };
    } else {
        return NextResponse.json(
            { error: 'Valid configuration (URL or BrowserConfig) is required' },
            { status: 400 }
        );
    }

    const hasSteps = steps && steps.length > 0;
    const hasPrompt = !!prompt;

    if (!hasSteps && !hasPrompt) {
        return NextResponse.json(
            { error: 'Instructions (Prompt or Steps) are required' },
            { status: 400 }
        );
    }

    // Shared state between start and cancel handlers
    let isClosed = false;
    const abortController = new AbortController();

    const stream = new ReadableStream({
        async start(controller) {
            let browser: any; // Type 'Browser' from playwright
            const contexts = new Map<string, BrowserContext>();
            const pages = new Map<string, Page>();
            const agents = new Map<string, PlaywrightAgent>();

            const log = (msg: string, type: 'info' | 'error' | 'success' = 'info', browserId?: string) => {
                // Check if already closed first to avoid race condition
                if (isClosed || controller.desiredSize === null) return;

                try {
                    controller.enqueue(encodeEvent({
                        type: 'log',
                        data: { message: msg, level: type },
                        browserId
                    }));
                } catch (e) {
                    // Silently ignore enqueue errors if stream is closed
                    if (!isClosed) {
                        console.error('Failed to enqueue log:', e);
                    }
                }
            };

            const sendScreenshot = async (p: Page, label: string, browserId?: string) => {
                // Check if already closed
                if (isClosed || controller.desiredSize === null) return;

                try {
                    const buffer = await p.screenshot({ type: 'jpeg', quality: 60 });
                    const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;

                    // Double-check before enqueuing as this is async
                    if (isClosed || controller.desiredSize === null) return;

                    controller.enqueue(encodeEvent({
                        type: 'screenshot',
                        data: { src: base64, label },
                        browserId
                    }));
                } catch (e) {
                    // Silently ignore if stream is closed
                    if (!isClosed) {
                        const errMsg = e instanceof Error ? e.message : String(e);
                        log(`Failed to capture screenshot: ${errMsg}`, 'error', browserId);
                    }
                }
            };

            const sendStatus = (status: 'PASS' | 'FAIL', error?: string) => {
                // Check if already closed
                if (isClosed || controller.desiredSize === null) return;

                try {
                    controller.enqueue(encodeEvent({ type: 'status', status, error }));
                } catch (e) {
                    // Silently ignore enqueue errors if stream is closed
                    if (!isClosed) {
                        console.error('Failed to send status:', e);
                    }
                }
            };

            const setupPage = async (context: BrowserContext, name: string, browserId: string) => {
                const p = await context.newPage();
                p.on('console', async (msg) => {
                    const type = msg.type();
                    if (type === 'log' || type === 'info') {
                        // avoid excessive debug logs
                        if (!msg.text().includes('[midscene]')) {
                            log(`[${name}] ${msg.text()}`, 'info', browserId);
                        }
                    } else if (type === 'error') {
                        log(`[${name} Error] ${msg.text()}`, 'error', browserId);
                    }
                });
                return p;
            };

            try {
                log('Launching browser...', 'info');
                browser = await chromium.launch({
                    headless: true,
                    timeout: 30000,
                    args: [
                        '--no-default-browser-check',
                        '--no-first-run',
                        '--disable-default-apps',
                        '--password-store=basic',
                        '--use-mock-keychain',
                    ]
                });
                log('Browser launched successfully', 'success');

                // Initialize all requested browsers
                const browserIds = Object.keys(targetConfigs);

                for (const browserId of browserIds) {
                    const config = targetConfigs[browserId];
                    const niceName = browserId === 'main' ? 'Browser' :
                        browserId.replace('browser_', 'Browser ').toUpperCase(); // browser_a -> Browser A

                    log(`Initializing ${niceName}...`, 'info', browserId);

                    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
                    const page = await setupPage(context, niceName, browserId);

                    contexts.set(browserId, context);
                    pages.set(browserId, page);

                    // Navigation
                    if (config.url) {
                        log(`[${niceName}] Navigating to ${config.url}...`, 'info', browserId);
                        await page.goto(config.url, { timeout: 30000, waitUntil: 'domcontentloaded' });
                        await sendScreenshot(page, `[${niceName}] Initial Page Load`, browserId);
                    }

                    // Agent
                    const agent = new PlaywrightAgent(page, {
                        onTaskStartTip: async (tip) => {
                            log(`[${niceName}] 🤖 ${tip}`, 'info', browserId);
                            if (page && !page.isClosed()) await sendScreenshot(page, `[${niceName}] ${tip}`, browserId);
                        }
                    });
                    agents.set(browserId, agent);
                }

                log('All browser instances ready', 'success');

                // Execution
                log('Executing test...', 'info');

                if (hasSteps) {
                    // Step-based execution (Multi or Single)
                    for (let i = 0; i < steps.length; i++) {
                        // Check if test was stopped
                        if (abortController.signal.aborted) {
                            log('Test execution stopped by user', 'info');
                            break;
                        }

                        const step: TestStep = steps[i];
                        const targetId = step.target;

                        // If target not specified, use first available or 'main'
                        const effectiveTargetId = targetId || browserIds[0];

                        const agent = agents.get(effectiveTargetId);
                        const page = pages.get(effectiveTargetId);
                        const config = targetConfigs[effectiveTargetId];
                        const niceName = effectiveTargetId === 'main' ? 'Browser' :
                            effectiveTargetId.replace('browser_', 'Browser ').toUpperCase();

                        if (!agent || !page) {
                            throw new Error(`Browser instance '${effectiveTargetId}' not found for step: ${step.action}`);
                        }

                        log(`[Step ${i + 1}] Executing on ${niceName}: ${step.action}`, 'info', effectiveTargetId);

                        let stepAction = step.action;
                        if (config && (config.username || config.password)) {
                            stepAction += `\n(Credentials: ${config.username} / ${config.password})`;
                        }

                        await agent.aiAct(stepAction);
                        await sendScreenshot(page, `[${niceName}] Step ${i + 1} Complete`, effectiveTargetId);
                    }
                } else {
                    // Legacy Prompt-based execution (Single Browser)
                    // Use 'main' or first available
                    const targetId = browserIds[0];
                    const agent = agents.get(targetId);
                    const config = targetConfigs[targetId];

                    if (!agent) throw new Error('No browser agent available');

                    let fullPrompt = prompt;
                    if (config.username || config.password) {
                        fullPrompt += `\n\nCredentials if needed:\nUsername: ${config.username}\nPassword: ${config.password}`;
                    }

                    await agent.aiAct(fullPrompt);
                }

                // Check if test was stopped before marking success
                if (!abortController.signal.aborted) {
                    log('✅ Test executed successfully', 'success');

                    // Final Screenshots
                    for (const [id, page] of pages) {
                        if (abortController.signal.aborted) break;
                        const niceName = id === 'main' ? 'Browser' : id.replace('browser_', 'Browser ').toUpperCase();
                        if (!page.isClosed()) await sendScreenshot(page, `[${niceName}] Final State`, id);
                    }

                    sendStatus('PASS');
                }

            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                log(`Critical System Error: ${msg}`, 'error');

                // Capture error state if possible (skip if stream was cancelled)
                if (!abortController.signal.aborted) {
                    try {
                        for (const [id, page] of pages) {
                            if (!page.isClosed()) await sendScreenshot(page, `Error State [${id}]`, id);
                        }
                    } catch (e) {
                        console.error('Failed to capture error screenshot', e);
                    }

                    sendStatus('FAIL', msg);
                }
            } finally {
                try {
                    if (browser) {
                        log('Closing browsers...', 'info');
                        await browser.close();
                        log('Browsers closed', 'success');
                    }
                } catch (e) {
                    console.error('Error closing browser:', e);
                } finally {
                    isClosed = true;
                    controller.close();
                }
            }
        },
        cancel() {
            // Handle stream cancellation (e.g., when user clicks "Stop Test")
            console.log('Stream cancelled by client');
            isClosed = true;
            abortController.abort();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}

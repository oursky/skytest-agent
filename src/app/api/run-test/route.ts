import { NextResponse } from 'next/server';
import { chromium, Page } from 'playwright';
import { PlaywrightAgent } from '@midscene/web/playwright';

export const dynamic = 'force-dynamic';

// Helper to encode data for streaming
function encodeEvent(data: unknown) {
    return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
    const { url, username, password, prompt } = await request.json();

    if (!url || !prompt) {
        return NextResponse.json(
            { error: 'URL and Prompt are required' },
            { status: 400 }
        );
    }

    const stream = new ReadableStream({
        async start(controller) {
            let browser;
            let page: Page | undefined;
            let isClosed = false;

            const log = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
                if (!isClosed) {
                    try {
                        controller.enqueue(encodeEvent({ type: 'log', data: { message: msg, level: type } }));
                    } catch (e) {
                        console.error('Failed to enqueue log:', e);
                    }
                }
            };

            const sendScreenshot = async (p: Page, label: string) => {
                if (isClosed) return;
                try {
                    const buffer = await p.screenshot({ type: 'jpeg', quality: 60 });
                    const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
                    controller.enqueue(encodeEvent({ type: 'screenshot', data: { src: base64, label } }));
                } catch (e) {
                    const errMsg = e instanceof Error ? e.message : String(e);
                    log(`Failed to capture screenshot: ${errMsg}`, 'error');
                }
            };

            const sendStatus = (status: 'PASS' | 'FAIL', error?: string) => {
                if (!isClosed) {
                    try {
                        controller.enqueue(encodeEvent({ type: 'status', status, error }));
                    } catch (e) {
                        console.error('Failed to send status:', e);
                    }
                }
            };

            try {
                log('Launching browser...', 'info');
                browser = await chromium.launch({
                    headless: true,
                    timeout: 30000
                });
                log('Browser launched successfully', 'success');

                const context = await browser.newContext({
                    viewport: { width: 1280, height: 800 },
                    deviceScaleFactor: 1,
                });
                page = await context.newPage();
                log('Browser page created', 'success');

                // Intercept console logs from the browser page
                page.on('console', async (msg) => {
                    const type = msg.type();
                    if (type === 'log' || type === 'info') {
                        log(`[Browser] ${msg.text()}`, 'info');
                    } else if (type === 'error') {
                        log(`[Browser Error] ${msg.text()}`, 'error');
                    }
                });

                log(`Navigating to ${url}...`, 'info');
                await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
                log('Page loaded successfully', 'success');
                await sendScreenshot(page, 'Initial Page Load');

                let fullPrompt = prompt;
                if (username || password) {
                    fullPrompt += `\n\nCredentials to use if needed:\nUsername: ${username}\nPassword: ${password}`;
                }

                log('Initializing AI Agent...', 'info');
                const agent = new PlaywrightAgent(page, {
                    onTaskStartTip: async (tip) => {
                        log(`🤖 ${tip}`, 'info');
                        if (page) await sendScreenshot(page, tip);
                    }
                });
                log('AI Agent initialized', 'success');

                // Execute the test
                log('Executing test steps...', 'info');
                try {
                    await agent.aiAction(fullPrompt);
                    log('✅ Test steps executed successfully', 'success');
                    await sendScreenshot(page, 'Final State - Success');
                    sendStatus('PASS');
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    log(`❌ Test execution failed: ${errorMessage}`, 'error');
                    await sendScreenshot(page, 'Final State - Failed');
                    sendStatus('FAIL', errorMessage);
                }

            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                log(`Critical System Error: ${msg}`, 'error');
                sendStatus('FAIL', msg);
            } finally {
                try {
                    if (browser) {
                        log('Closing browser...', 'info');
                        await browser.close();
                        log('Browser closed', 'success');
                    }
                } catch (e) {
                    console.error('Error closing browser:', e);
                } finally {
                    isClosed = true;
                    controller.close();
                }
            }
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

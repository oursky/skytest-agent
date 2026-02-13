#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
    const options = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--')) {
            continue;
        }

        const [rawKey, inlineValue] = arg.slice(2).split('=');
        if (!rawKey) {
            continue;
        }

        if (inlineValue !== undefined) {
            options[rawKey] = inlineValue;
            continue;
        }

        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            options[rawKey] = 'true';
            continue;
        }

        options[rawKey] = next;
        index += 1;
    }

    return options;
}

function toInt(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBool(value) {
    return value === 'true' || value === '1';
}

function percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[rank];
}

async function issueStreamToken(baseUrl, authToken, runId) {
    const response = await fetch(`${baseUrl}/api/stream-tokens`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            scope: 'test-run-events',
            resourceId: runId,
        }),
    });

    if (!response.ok) {
        return null;
    }

    const data = await response.json();
    return typeof data.streamToken === 'string' ? data.streamToken : null;
}

async function holdSseConnection(baseUrl, runId, streamToken, holdMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), holdMs);

    try {
        const response = await fetch(
            `${baseUrl}/api/test-runs/${runId}/events?streamToken=${encodeURIComponent(streamToken)}`,
            { signal: controller.signal }
        );
        if (!response.ok || !response.body) {
            return { ok: false, error: `SSE status ${response.status}` };
        }

        const reader = response.body.getReader();
        const start = performance.now();
        let receivedAnyChunk = false;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && value.length > 0) {
                receivedAnyChunk = true;
            }
            if (performance.now() - start >= holdMs) {
                controller.abort();
                break;
            }
        }

        return { ok: receivedAnyChunk };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            return { ok: true };
        }
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
        clearTimeout(timeoutId);
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (toBool(args.help) || toBool(args.h)) {
        console.log([
            'Usage:',
            '  node scripts/load-test-smoke.mjs --base-url http://localhost:3000 --auth-token <token> --test-case-id <id> [options]',
            '',
            'Options:',
            '  --requests <n>       Total run submissions (default: 20)',
            '  --concurrency <n>    Parallel submit workers (default: 3)',
            '  --sse true|false     Also open SSE stream for each successful run (default: true)',
            '  --sse-hold-ms <ms>   SSE hold duration per stream (default: 3000)',
            '  --url <url>          URL sent to /api/run-test (default: https://example.com)',
            '  --prompt <text>      Prompt sent to /api/run-test (default: "Open the page and verify it loads")',
        ].join('\n'));
        return;
    }

    const baseUrl = String(args['base-url'] ?? '').replace(/\/$/, '');
    const authToken = String(args['auth-token'] ?? '');
    const testCaseId = String(args['test-case-id'] ?? '');
    const requests = toInt(args.requests, 20);
    const concurrency = toInt(args.concurrency, 3);
    const enableSse = args.sse === undefined ? true : toBool(args.sse);
    const sseHoldMs = toInt(args['sse-hold-ms'], 3000);
    const targetUrl = String(args.url ?? 'https://example.com');
    const prompt = String(args.prompt ?? 'Open the page and verify it loads');

    if (!baseUrl || !authToken || !testCaseId) {
        console.error('Missing required flags: --base-url, --auth-token, --test-case-id');
        process.exitCode = 1;
        return;
    }

    const latencies = [];
    const statusCounts = new Map();
    const failures = [];
    const runIds = [];
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < requests) {
            const current = nextIndex;
            nextIndex += 1;

            const startedAt = performance.now();
            try {
                const response = await fetch(`${baseUrl}/api/run-test`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        testCaseId,
                        url: targetUrl,
                        prompt,
                    }),
                });

                const durationMs = performance.now() - startedAt;
                latencies.push(durationMs);

                const key = String(response.status);
                statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);

                if (!response.ok) {
                    const text = await response.text();
                    failures.push(`#${current + 1} status=${response.status} body=${text.slice(0, 240)}`);
                    continue;
                }

                const data = await response.json();
                if (typeof data.runId === 'string') {
                    runIds.push(data.runId);
                }
            } catch (error) {
                failures.push(`#${current + 1} error=${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    const totalStart = performance.now();
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const totalDurationMs = performance.now() - totalStart;

    const sseFailures = [];
    if (enableSse && runIds.length > 0) {
        await Promise.all(runIds.map(async (runId) => {
            const streamToken = await issueStreamToken(baseUrl, authToken, runId);
            if (!streamToken) {
                sseFailures.push(`${runId}: failed to issue stream token`);
                return;
            }

            const sseResult = await holdSseConnection(baseUrl, runId, streamToken, sseHoldMs);
            if (!sseResult.ok) {
                sseFailures.push(`${runId}: ${sseResult.error || 'no data received'}`);
            }
        }));
    }

    const successCount = (statusCounts.get('200') ?? 0);
    const rps = requests / Math.max(1, totalDurationMs / 1000);

    console.log('\nLoad Test Smoke Summary');
    console.log(`baseUrl=${baseUrl}`);
    console.log(`requests=${requests} concurrency=${concurrency} durationMs=${Math.round(totalDurationMs)} rps=${rps.toFixed(2)}`);
    console.log(`statusCounts=${JSON.stringify(Object.fromEntries(statusCounts))}`);
    console.log(`latencyMs p50=${percentile(latencies, 50).toFixed(1)} p95=${percentile(latencies, 95).toFixed(1)} max=${Math.max(0, ...latencies).toFixed(1)}`);
    console.log(`submittedRuns=${successCount}`);
    if (enableSse) {
        console.log(`sseChecks=${runIds.length} sseFailures=${sseFailures.length}`);
    }

    if (failures.length > 0) {
        console.log('\nSubmission Failures (first 10):');
        for (const failure of failures.slice(0, 10)) {
            console.log(`- ${failure}`);
        }
    }

    if (sseFailures.length > 0) {
        console.log('\nSSE Failures (first 10):');
        for (const failure of sseFailures.slice(0, 10)) {
            console.log(`- ${failure}`);
        }
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});

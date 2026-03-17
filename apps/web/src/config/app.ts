import { TEST_STATUS } from '@/types';

function parseBoundedIntEnv(input: {
    name: string;
    fallback: number;
    min: number;
    max: number;
}): number {
    const value = Number.parseInt(process.env[input.name] ?? '', 10);
    if (!Number.isFinite(value)) {
        return input.fallback;
    }

    return Math.min(input.max, Math.max(input.min, value));
}

const storageSignedUrlTtlSeconds = parseBoundedIntEnv({
    name: 'STORAGE_SIGNED_URL_TTL_SECONDS',
    fallback: 900,
    min: 60,
    max: 86_400,
});
const streamPollIntervalMs = parseBoundedIntEnv({
    name: 'STREAM_POLL_INTERVAL_MS',
    fallback: 5_000,
    min: 500,
    max: 30_000,
});
const streamMaxPollIntervalMs = parseBoundedIntEnv({
    name: 'STREAM_MAX_POLL_INTERVAL_MS',
    fallback: 30_000,
    min: streamPollIntervalMs,
    max: 120_000,
});
const runnerLeaseDurationSeconds = parseBoundedIntEnv({
    name: 'RUNNER_LEASE_DURATION_SECONDS',
    fallback: 120,
    min: 30,
    max: 900,
});
const runnerMaxConcurrentRuns = parseBoundedIntEnv({
    name: 'RUNNER_MAX_CONCURRENT_RUNS',
    fallback: 4,
    min: 1,
    max: 200,
});
const projectMaxConcurrentRunsMax = parseBoundedIntEnv({
    name: 'PROJECT_MAX_CONCURRENT_RUNS_MAX',
    fallback: 5,
    min: 1,
    max: 50,
});
const runnerLeaseReaperIntervalMs = parseBoundedIntEnv({
    name: 'RUNNER_LEASE_REAPER_INTERVAL_MS',
    fallback: 60_000,
    min: 5_000,
    max: 600_000,
});
const runnerMaxLocalBrowserRuns = parseBoundedIntEnv({
    name: 'RUNNER_MAX_LOCAL_BROWSER_RUNS',
    fallback: 1,
    min: 1,
    max: 20,
});
const runnerRunStatusPollIntervalMs = parseBoundedIntEnv({
    name: 'RUNNER_RUN_STATUS_POLL_INTERVAL_MS',
    fallback: 5_000,
    min: 500,
    max: 30_000,
});
const runnerRunStatusMaxPollIntervalMs = parseBoundedIntEnv({
    name: 'RUNNER_RUN_STATUS_MAX_POLL_INTERVAL_MS',
    fallback: 30_000,
    min: runnerRunStatusPollIntervalMs,
    max: 120_000,
});
const runnerEventRetentionDays = parseBoundedIntEnv({
    name: 'RUNNER_EVENT_RETENTION_DAYS',
    fallback: 30,
    min: 1,
    max: 3_650,
});
const runnerArtifactSoftDeleteDays = parseBoundedIntEnv({
    name: 'RUNNER_ARTIFACT_SOFT_DELETE_DAYS',
    fallback: 30,
    min: 1,
    max: 3_650,
});
const runnerArtifactHardDeleteDays = parseBoundedIntEnv({
    name: 'RUNNER_ARTIFACT_HARD_DELETE_DAYS',
    fallback: 7,
    min: 0,
    max: 3_650,
});
const runnerArtifactHardDeleteBatchSize = parseBoundedIntEnv({
    name: 'RUNNER_ARTIFACT_HARD_DELETE_BATCH_SIZE',
    fallback: 50,
    min: 1,
    max: 2_000,
});
const uiDeviceStatusPollIntervalMs = parseBoundedIntEnv({
    name: 'UI_DEVICE_STATUS_POLL_INTERVAL_MS',
    fallback: 10_000,
    min: 1_000,
    max: 120_000,
});
const midsceneGenerateReport = process.env.SKYTEST_MIDSCENE_GENERATE_REPORT === 'true';
const midsceneAutoPrintReportMsg = process.env.SKYTEST_MIDSCENE_AUTO_PRINT_REPORT_MSG === 'true';

export const config = {
    app: {
        name: 'SkyTest Agent',
        locale: 'en-GB',
    },

    logging: {
        // Server-side log level: 'debug' | 'info' | 'warn' | 'error'
        // Override with LOG_LEVEL environment variable
        defaultLevel: 'info',
        // Enable Prisma query logging with PRISMA_LOG_QUERIES=true
        // Note: "Midscene - report file updated" logs come from @midscene/web library
    },

    api: {
        maxRunRequestBodyBytes: 64 * 1024,
        endpoints: {
            PROJECTS: '/api/projects',
            TEST_CASES: '/api/test-cases',
            TEST_RUNS: '/api/test-runs',
            TEST_RUNS_DISPATCH: '/api/test-runs/dispatch',
        },
    },

    stream: {
        pollInterval: streamPollIntervalMs,
        maxPollIntervalMs: streamMaxPollIntervalMs,
        sseConnectionTtlMs: 5 * 60 * 1000,
    },

    runner: {
        leaseDurationSeconds: runnerLeaseDurationSeconds,
        maxConcurrentRuns: runnerMaxConcurrentRuns,
        maxProjectConcurrentRuns: projectMaxConcurrentRunsMax,
        maxLocalBrowserRuns: runnerMaxLocalBrowserRuns,
        runStatusPollIntervalMs: runnerRunStatusPollIntervalMs,
        runStatusMaxPollIntervalMs: runnerRunStatusMaxPollIntervalMs,
        leaseReaperIntervalMs: runnerLeaseReaperIntervalMs,
        eventRetentionDays: runnerEventRetentionDays,
        artifactSoftDeleteDays: runnerArtifactSoftDeleteDays,
        artifactHardDeleteDays: runnerArtifactHardDeleteDays,
        artifactHardDeleteBatchSize: runnerArtifactHardDeleteBatchSize,
    },

    test: {
        maxDuration: 600,
        browser: {
            viewport: {
                width: 1280,
                height: 800,
            },
            timeout: 30000,
            navigation: {
                urlChangeTimeoutMs: 3000,
                domContentLoadedTimeoutMs: 10000,
                settleDelayMs: 3000,
            },
            args: [
                '--no-default-browser-check',
                '--no-first-run',
                '--disable-default-apps',
                '--password-store=basic',
                '--use-mock-keychain',
            ] as string[],
        },
        screenshot: {
            type: 'jpeg' as const,
            quality: 60,
        },
        android: {
            postLaunchStabilizationMs: 8_000,
            recoveryRetryDelayMs: 1_000,
            recoveryForegroundTimeoutMs: 10_000,
            launchForegroundTimeoutMs: 20_000,
            uiReadyCheckIntervalMs: 1_000,
            wakeUnlockStabilizationMs: 500,
        },
        security: {
            allowedUrlProtocols: ['http:', 'https:'],
            blockedHostnames: ['localhost', '127.0.0.1', '0.0.0.0', '::1'],
            blockedHostnameSuffixes: ['.local', '.internal', '.home', '.lan'],
            blockedIpv4Cidrs: [
                '0.0.0.0/8',
                '10.0.0.0/8',
                '127.0.0.0/8',
                '169.254.0.0/16',
                '172.16.0.0/12',
                '192.168.0.0/16',
            ],
            blockedIpv6Prefixes: ['::1', 'fc', 'fd'],
            dnsLookupTimeoutMs: 5000,
            dnsLookupRetryAttempts: 3,
            dnsLookupRetryDelayMs: 200,
            dnsCacheTtlMs: 5 * 60 * 1000,
            blockedRequestLogDedupMs: 10000,
            playwrightCodeBlockedTokens: [
                'require',
                'import',
                'export',
                'process',
                'global',
                'globalThis',
                'window',
                'document',
                'Function',
                'eval',
                'child_process',
                'fs',
                'net',
                'http',
                'https',
                'dgram',
                'tls',
                'fetch',
                'XMLHttpRequest',
                'Buffer',
            ],
        },
        playwrightCode: {
            statementTimeoutMs: 30000,
            syncTimeoutMs: 5000,
        },
        midscene: {
            generateReport: midsceneGenerateReport,
            autoPrintReportMsg: midsceneAutoPrintReportMsg,
        },
    },

    ui: {
        deviceStatusPollIntervalMs: uiDeviceStatusPollIntervalMs,
        statusColors: {
            [TEST_STATUS.QUEUED]: 'bg-blue-100 text-blue-700',
            [TEST_STATUS.PREPARING]: 'bg-cyan-100 text-cyan-700',
            [TEST_STATUS.RUNNING]: 'bg-yellow-100 text-yellow-700',
            [TEST_STATUS.PASS]: 'bg-green-100 text-green-700',
            [TEST_STATUS.FAIL]: 'bg-red-100 text-red-700',
            [TEST_STATUS.CANCELLED]: 'bg-gray-100 text-gray-700',
        },
        browserColors: [
            'bg-blue-500',
            'bg-green-500',
            'bg-purple-500',
            'bg-orange-500',
            'bg-pink-500',
            'bg-teal-500',
            'bg-indigo-500',
            'bg-yellow-500',
        ],
    },

    files: {
        maxFileSize: 10 * 1024 * 1024,
        maxFilesPerTestCase: 20,
        allowedMimeTypes: [
            'application/pdf',
            'text/plain',
            'text/markdown',
            'text/csv',
            'application/json',
            'application/xml',
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'application/zip',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ] as string[],
        allowedExtensions: [
            '.pdf', '.txt', '.md', '.csv', '.json', '.xml',
            '.jpg', '.jpeg', '.png', '.gif', '.webp',
            '.zip',
            '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        ] as string[],
    },

    storage: {
        bucket: process.env.GCS_BUCKET ?? '',
        projectId: process.env.GCS_PROJECT_ID ?? '',
        serviceAccountJsonBase64: process.env.GCS_SERVICE_ACCOUNT_JSON_BASE64 ?? '',
        emulatorHost: process.env.STORAGE_EMULATOR_HOST ?? '',
        signedUrlTtlSeconds: storageSignedUrlTtlSeconds,
    },

    emulator: {
        bootTimeoutMs: 120_000,
        bootMaxAttempts: 2,
        bootRetryDelayMs: 5_000,
        idleTimeoutMs: 300_000,
        windowIdleTimeoutMs: 600_000,
        healthCheckIntervalMs: 60_000,

        adb: {
            commandTimeoutMs: 15_000,
            maxRetries: 3,
            retryDelayMs: 2_000,
        },

        basePort: 5554,
        launchArgs: {
            shared: [
                '-no-audio',
                '-no-boot-anim',
                '-gpu',
                'swiftshader_indirect',
            ] as string[],
            headless: [
                '-no-window',
            ] as string[],
        },
    },

} as const;

export type Config = typeof config;

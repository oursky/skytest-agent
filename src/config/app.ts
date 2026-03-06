const maxConcurrentTestRunsPerUserValue = Number.parseInt(process.env.MAX_CONCURRENT_TEST_RUNS_PER_USER ?? '', 10);
const maxConcurrentTestRunsPerUser = Number.isFinite(maxConcurrentTestRunsPerUserValue) && maxConcurrentTestRunsPerUserValue > 0
    ? maxConcurrentTestRunsPerUserValue
    : 5;
const storageSignedUrlTtlSecondsValue = Number.parseInt(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? '', 10);
const storageSignedUrlTtlSeconds = Number.isFinite(storageSignedUrlTtlSecondsValue) && storageSignedUrlTtlSecondsValue > 0
    ? storageSignedUrlTtlSecondsValue
    : 900;
const runnerLeaseDurationSecondsValue = Number.parseInt(process.env.RUNNER_LEASE_DURATION_SECONDS ?? '', 10);
const runnerLeaseDurationSeconds = Number.isFinite(runnerLeaseDurationSecondsValue) && runnerLeaseDurationSecondsValue > 0
    ? runnerLeaseDurationSecondsValue
    : 120;
const runnerLeaseReaperIntervalMsValue = Number.parseInt(process.env.RUNNER_LEASE_REAPER_INTERVAL_MS ?? '', 10);
const runnerLeaseReaperIntervalMs = Number.isFinite(runnerLeaseReaperIntervalMsValue) && runnerLeaseReaperIntervalMsValue > 0
    ? runnerLeaseReaperIntervalMsValue
    : 15_000;
const runnerEventRetentionDaysValue = Number.parseInt(process.env.RUNNER_EVENT_RETENTION_DAYS ?? '', 10);
const runnerEventRetentionDays = Number.isFinite(runnerEventRetentionDaysValue) && runnerEventRetentionDaysValue > 0
    ? runnerEventRetentionDaysValue
    : 30;

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
            RUN_TEST: '/api/run-test',
        },
    },

    queue: {
        concurrency: maxConcurrentTestRunsPerUser,
        maxConcurrentPerUser: maxConcurrentTestRunsPerUser,
        pollInterval: 500,
        persistFlushMs: 1000,
        cancelForceReleaseMs: 5000,
        sseConnectionTtlMs: 5 * 60 * 1000,
        logRetentionMs: 10000,
        maxEventsPerRun: 2000,
        maxScreenshotsPerRun: 300,
    },

    runner: {
        leaseDurationSeconds: runnerLeaseDurationSeconds,
        leaseReaperIntervalMs: runnerLeaseReaperIntervalMs,
        eventRetentionDays: runnerEventRetentionDays,
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
    },

    ui: {
        statusColors: {
            IDLE: 'bg-gray-100 text-gray-700',
            QUEUED: 'bg-blue-100 text-blue-700',
            PREPARING: 'bg-cyan-100 text-cyan-700',
            RUNNING: 'bg-yellow-100 text-yellow-700',
            PASS: 'bg-green-100 text-green-700',
            FAIL: 'bg-red-100 text-red-700',
            CANCELLED: 'bg-gray-100 text-gray-700',
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
        endpoint: process.env.S3_ENDPOINT ?? '',
        region: process.env.S3_REGION ?? '',
        bucket: process.env.S3_BUCKET ?? '',
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
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
export type TestStatus = keyof typeof config.ui.statusColors;

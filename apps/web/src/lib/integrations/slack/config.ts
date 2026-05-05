export const slackNotificationPolicy = {
    sweepIntervalMs: 300_000,
    sweepBatchSize: 25,
    maxAttempts: 5,
    claimTtlMs: 90_000,
    sweepStabilityDelayMs: 90_000,
    sweepMaxAgeMs: 24 * 60 * 60 * 1_000,
} as const;


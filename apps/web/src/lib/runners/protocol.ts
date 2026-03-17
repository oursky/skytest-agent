import {
    RUNNER_MINIMUM_VERSION,
    RUNNER_PROTOCOL_CURRENT_VERSION,
    RUNNER_PROTOCOL_MINIMUM_VERSION,
    type CompatibilityMetadata,
    type RunnerTransportMetadata,
} from '@skytest/runner-protocol';

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parsePositiveIntEnv(input: {
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

const HEARTBEAT_INTERVAL_SECONDS = parsePositiveIntEnv({
    name: 'RUNNER_HEARTBEAT_INTERVAL_SECONDS',
    fallback: 45,
    min: 5,
    max: 300,
});
const CLAIM_LONG_POLL_TIMEOUT_SECONDS = parsePositiveIntEnv({
    name: 'RUNNER_CLAIM_LONG_POLL_TIMEOUT_SECONDS',
    fallback: 30,
    min: 10,
    max: 120,
});
const DEVICE_SYNC_INTERVAL_SECONDS = parsePositiveIntEnv({
    name: 'RUNNER_DEVICE_SYNC_INTERVAL_SECONDS',
    fallback: 45,
    min: 10,
    max: 600,
});

const parseSemver = (version: string): [number, number, number] | null => {
    const match = SEMVER_PATTERN.exec(version.trim());
    if (!match) {
        return null;
    }

    return [
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10),
        Number.parseInt(match[3], 10),
    ];
};

const compareSemver = (left: string, right: string): number | null => {
    const leftParts = parseSemver(left);
    const rightParts = parseSemver(right);
    if (!leftParts || !rightParts) {
        return null;
    }

    for (let i = 0; i < leftParts.length; i += 1) {
        if (leftParts[i] > rightParts[i]) {
            return 1;
        }
        if (leftParts[i] < rightParts[i]) {
            return -1;
        }
    }

    return 0;
};

export function evaluateRunnerCompatibility(input: {
    protocolVersion: string;
    runnerVersion: string;
}): CompatibilityMetadata {
    const protocolVsMinimum = compareSemver(input.protocolVersion, RUNNER_PROTOCOL_MINIMUM_VERSION);
    const protocolVsCurrent = compareSemver(input.protocolVersion, RUNNER_PROTOCOL_CURRENT_VERSION);
    const runnerVsMinimum = compareSemver(input.runnerVersion, RUNNER_MINIMUM_VERSION);

    const unsupportedProtocol = protocolVsMinimum === null
        || protocolVsCurrent === null
        || protocolVsMinimum < 0
        || protocolVsCurrent > 0;
    const outdatedRunner = runnerVsMinimum === null || runnerVsMinimum < 0;

    return {
        currentProtocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        minimumSupportedProtocolVersion: RUNNER_PROTOCOL_MINIMUM_VERSION,
        minimumSupportedRunnerVersion: RUNNER_MINIMUM_VERSION,
        upgradeRequired: unsupportedProtocol || outdatedRunner,
    };
}

export function getRunnerTransportMetadata(): RunnerTransportMetadata {
    return {
        heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
        claimLongPollTimeoutSeconds: CLAIM_LONG_POLL_TIMEOUT_SECONDS,
        deviceSyncIntervalSeconds: DEVICE_SYNC_INTERVAL_SECONDS,
    };
}

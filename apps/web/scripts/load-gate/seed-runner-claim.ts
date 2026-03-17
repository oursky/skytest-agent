import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    RUNNER_MINIMUM_VERSION,
    RUNNER_PROTOCOL_CURRENT_VERSION,
} from '@skytest/runner-protocol';
import { prisma } from '../../src/lib/core/prisma';
import { generateRunnerToken } from '../../src/lib/runners/credentials';

function parseBoundedIntEnv(input: {
    name: string;
    fallback: number;
    min: number;
    max: number;
}): number {
    const raw = Number.parseInt(process.env[input.name] ?? '', 10);
    if (!Number.isFinite(raw)) {
        return input.fallback;
    }
    return Math.min(input.max, Math.max(input.min, raw));
}

async function ensureParentDirectory(filePath: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
    const runSeed = `load-gate-${Date.now()}`;
    const envFilePath = process.env.LOAD_GATE_ENV_FILE ?? '/tmp/skytest-load-gate.env';
    const runCount = parseBoundedIntEnv({
        name: 'LOAD_GATE_RUN_COUNT',
        fallback: 1200,
        min: 100,
        max: 20000,
    });
    const deviceCount = parseBoundedIntEnv({
        name: 'LOAD_GATE_DEVICE_COUNT',
        fallback: 32,
        min: 1,
        max: 512,
    });
    const maxConcurrentRuns = parseBoundedIntEnv({
        name: 'LOAD_GATE_PROJECT_MAX_CONCURRENT_RUNS',
        fallback: 2000,
        min: 1,
        max: 50000,
    });

    const user = await prisma.user.create({
        data: {
            authId: `${runSeed}-auth`,
            email: `${runSeed}@example.invalid`,
        },
        select: { id: true },
    });

    const team = await prisma.team.create({
        data: {
            name: runSeed,
        },
        select: { id: true },
    });

    const project = await prisma.project.create({
        data: {
            name: `${runSeed}-project`,
            teamId: team.id,
            createdByUserId: user.id,
            maxConcurrentRuns,
        },
        select: { id: true },
    });

    const testCase = await prisma.testCase.create({
        data: {
            name: `${runSeed}-test-case`,
            projectId: project.id,
            url: 'https://example.com',
        },
        select: { id: true },
    });

    const runner = await prisma.runner.create({
        data: {
            displayId: `${runSeed}-runner`,
            hostFingerprint: `${runSeed}-host`,
            teamId: team.id,
            label: 'Load Gate Runner',
            kind: 'MACOS_AGENT',
            capabilities: ['ANDROID'],
            protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
            runnerVersion: RUNNER_MINIMUM_VERSION,
            status: 'ONLINE',
            lastSeenAt: new Date(),
        },
        select: { id: true },
    });

    const devices = Array.from({ length: deviceCount }, (_, index) => ({
        runnerId: runner.id,
        deviceId: `emulator-profile:load-gate-${index + 1}`,
        platform: 'ANDROID',
        name: `Load Gate Device ${index + 1}`,
        state: 'ONLINE',
        metadata: {
            inventoryKind: 'emulator-profile',
            emulatorProfileName: `load-gate-${index + 1}`,
        },
        lastSeenAt: new Date(),
    }));
    await prisma.runnerDevice.createMany({ data: devices });

    const runs = Array.from({ length: runCount }, (_, index) => ({
        testCaseId: testCase.id,
        status: 'QUEUED',
        requiredCapability: 'ANDROID',
        requiredRunnerKind: 'MACOS_AGENT',
        requestedDeviceId: devices[index % devices.length].deviceId,
    }));
    await prisma.testRun.createMany({ data: runs });

    const runnerToken = generateRunnerToken();
    const credentialExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.runnerToken.create({
        data: {
            teamId: team.id,
            runnerId: runner.id,
            kind: 'RUNNER',
            prefix: runnerToken.prefix,
            hash: runnerToken.hash,
            expiresAt: credentialExpiresAt,
        },
    });

    await ensureParentDirectory(envFilePath);
    await writeFile(envFilePath, [
        `RUNNER_TOKEN=${runnerToken.raw}`,
        `RUNNER_PROTOCOL_VERSION=${RUNNER_PROTOCOL_CURRENT_VERSION}`,
        `RUNNER_VERSION=${RUNNER_MINIMUM_VERSION}`,
        `LOAD_GATE_TEAM_ID=${team.id}`,
        `LOAD_GATE_RUN_COUNT=${runCount}`,
    ].join('\n'), 'utf8');

    console.log(JSON.stringify({
        envFilePath,
        runCount,
        deviceCount,
        teamId: team.id,
        runnerId: runner.id,
    }));
}

void main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

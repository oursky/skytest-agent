import { ChildProcess, execFile, spawn } from 'node:child_process';
import { config as appConfig } from '@/config/app';
import { createLogger } from './logger';
import { ReliableAdb } from './adb-reliable';
import { resolveAndroidToolPath } from './android-sdk';
import type { AndroidDevice, AndroidAgent } from '@/types/android';

const logger = createLogger('emulator-pool');

export type EmulatorState = 'STARTING' | 'BOOTING' | 'IDLE' | 'ACQUIRED' | 'CLEANING' | 'STOPPING' | 'DEAD';

export interface EmulatorHandle {
    id: string;
    projectId: string;
    avdName: string;
    state: EmulatorState;
    device: AndroidDevice | null;
    agent: AndroidAgent | null;
    acquiredAt: number;
    runId: string;
    packageName?: string;
}

export interface EmulatorPoolStatusItem {
    id: string;
    projectId: string;
    avdName: string;
    state: EmulatorState;
    runId?: string;
    runTestCaseId?: string;
    runTestCaseName?: string;
    runTestCaseDisplayId?: string;
    uptimeMs: number;
    memoryUsageMb?: number;
}

export interface EmulatorPoolStatus {
    maxEmulators: number;
    emulators: EmulatorPoolStatusItem[];
    waitingRequests: number;
}

interface WaitQueueEntry {
    projectId: string;
    avdName: string;
    runId: string;
    resolve: (handle: EmulatorHandle) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
    signal?: AbortSignal;
}

interface EmulatorInstance {
    id: string;
    projectId: string;
    avdName: string;
    state: EmulatorState;
    port: number;
    serial: string;
    process: ChildProcess | null;
    adb: ReliableAdb;
    device: AndroidDevice | null;
    agent: AndroidAgent | null;
    runId: string | null;
    startedAt: number;
    acquiredAt: number | null;
    idleTimer: NodeJS.Timeout | null;
    healthCheckTimer: NodeJS.Timeout | null;
    forceReclaimTimer: NodeJS.Timeout | null;
    memoryUsageMb: number | undefined;
}

interface MidsceneAndroidDevice {
    connect(): Promise<void>;
}

interface MidsceneAndroidDeviceConstructor {
    new (udid: string): MidsceneAndroidDevice;
}

interface MidsceneAndroidAgentConstructor {
    new (
        device: MidsceneAndroidDevice,
        options?: { groupName?: string; aiActionContext?: string }
    ): AndroidAgent;
}

interface MidsceneAndroidRuntimeModule {
    AndroidDevice: MidsceneAndroidDeviceConstructor;
    AndroidAgent: MidsceneAndroidAgentConstructor;
}

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve({ stdout: String(stdout), stderr: String(stderr) });
        });
    });
}

export class EmulatorPool {
    private static instance: EmulatorPool;
    private emulators: Map<string, EmulatorInstance> = new Map();
    private waitQueue: WaitQueueEntry[] = [];
    private usedPorts: Set<number> = new Set();
    private readonly adbPath: string;
    private readonly emulatorPath: string;

    private constructor() {
        this.adbPath = resolveAndroidToolPath('adb');
        this.emulatorPath = resolveAndroidToolPath('emulator');
    }

    static getInstance(): EmulatorPool {
        if (!EmulatorPool.instance) {
            EmulatorPool.instance = new EmulatorPool();
        }
        return EmulatorPool.instance;
    }

    async initialize(): Promise<void> {
        await this.ensureAdbServer();
    }

    async boot(projectId: string, avdName: string): Promise<EmulatorHandle> {
        const port = await this.allocatePort();
        if (port === null) {
            throw new Error('No available ports for emulator');
        }

        const serial = `emulator-${port}`;
        const id = serial;
        const adb = new ReliableAdb(serial, this.adbPath);

        const instance: EmulatorInstance = {
            id,
            projectId,
            avdName,
            state: 'STARTING',
            port,
            serial,
            process: null,
            adb,
            device: null,
            agent: null,
            runId: null,
            startedAt: Date.now(),
            acquiredAt: null,
            idleTimer: null,
            healthCheckTimer: null,
            forceReclaimTimer: null,
            memoryUsageMb: undefined,
        };

        this.emulators.set(id, instance);
        this.usedPorts.add(port);

        try {
            await this.launchEmulatorProcess(instance);
            await Promise.race([
                this.waitForBoot(instance),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`Emulator ${id} boot timed out (${appConfig.emulator.bootTimeoutMs}ms)`)),
                        appConfig.emulator.bootTimeoutMs
                    )
                ),
            ]);
            await this.attachAndroidRuntime(instance);
        } catch (error) {
            await this.stopInstance(instance);
            throw error;
        }

        instance.state = 'IDLE';
        this.scheduleIdleTimeout(instance);
        this.scheduleHealthCheck(instance);
        logger.info(`Emulator ${id} is IDLE`);

        return this.makeHandle(instance);
    }

    async acquire(projectId: string, avdName: string, runId: string, signal?: AbortSignal): Promise<EmulatorHandle> {
        if (signal?.aborted) throw new Error('Acquisition cancelled');

        await this.reclaimStaleBootingInstances();

        const idleEmulator = this.findIdleEmulator(projectId, avdName);
        if (idleEmulator) {
            return this.lockEmulator(idleEmulator, runId);
        }

        const activeCount = Array.from(this.emulators.values()).filter((emulator) => emulator.state !== 'DEAD').length;
        if (activeCount < appConfig.emulator.maxInstances) {
            const handle = await this.bootWithRetries(projectId, avdName, signal);
            const instance = this.emulators.get(handle.id);
            if (!instance) {
                throw new Error(`Emulator ${handle.id} disappeared after boot`);
            }
            return this.lockEmulator(instance, runId);
        }

        return new Promise<EmulatorHandle>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const index = this.waitQueue.findIndex((entry) => entry.timeoutId === timeoutId);
                if (index !== -1) {
                    this.waitQueue.splice(index, 1);
                }
                reject(new Error(
                    `No emulator available within ${appConfig.emulator.acquireTimeoutMs / 1000}s. ` +
                    `All ${appConfig.emulator.maxInstances} emulators are in use.`
                ));
            }, appConfig.emulator.acquireTimeoutMs);

            const entry: WaitQueueEntry = { projectId, avdName, runId, resolve, reject, timeoutId, signal };

            if (signal) {
                signal.addEventListener('abort', () => {
                    const index = this.waitQueue.findIndex((candidate) => candidate === entry);
                    if (index !== -1) {
                        this.waitQueue.splice(index, 1);
                        clearTimeout(timeoutId);
                        reject(new Error('Acquisition cancelled'));
                    }
                }, { once: true });
            }

            this.waitQueue.push(entry);
        });
    }

    async acquireById(emulatorId: string, runId: string, signal?: AbortSignal): Promise<EmulatorHandle> {
        if (signal?.aborted) throw new Error('Acquisition cancelled');

        const start = Date.now();
        const timeoutMs = appConfig.emulator.acquireTimeoutMs;

        while (Date.now() - start < timeoutMs) {
            if (signal?.aborted) {
                throw new Error('Acquisition cancelled');
            }

            const instance = this.emulators.get(emulatorId);
            if (!instance || instance.state === 'DEAD') {
                throw new Error(`Emulator "${emulatorId}" is not available`);
            }

            if (instance.state === 'IDLE') {
                return this.lockEmulator(instance, runId);
            }

            await this.sleep(1000);
        }

        throw new Error(`Emulator "${emulatorId}" was not available within ${timeoutMs / 1000}s`);
    }

    async release(handle: EmulatorHandle): Promise<void> {
        const instance = this.emulators.get(handle.id);
        if (!instance) {
            logger.warn(`Tried to release unknown emulator ${handle.id}`);
            return;
        }

        if (instance.state !== 'ACQUIRED') {
            logger.warn(`Tried to release emulator ${handle.id} in state ${instance.state}`);
            return;
        }

        if (instance.forceReclaimTimer) {
            clearTimeout(instance.forceReclaimTimer);
            instance.forceReclaimTimer = null;
        }

        instance.state = 'CLEANING';
        instance.runId = null;
        instance.acquiredAt = null;
        logger.info(`Releasing emulator ${instance.id}`);

        const cleanSuccess = await this.cleanEmulator(instance, handle.packageName);
        if (!cleanSuccess) {
            await this.stopInstance(instance);
            this.wakeNextWaiter(true);
            return;
        }

        instance.state = 'IDLE';
        this.scheduleIdleTimeout(instance);
        this.scheduleHealthCheck(instance);
        this.wakeNextWaiter();
    }

    async stop(emulatorId: string): Promise<void> {
        const instance = this.emulators.get(emulatorId);
        if (!instance) {
            return;
        }
        await this.stopInstance(instance);
    }

    getStatus(projectIds?: ReadonlySet<string>): EmulatorPoolStatus {
        const now = Date.now();
        const emulators = Array.from(this.emulators.values())
            .filter((instance) => instance.state !== 'DEAD')
            .filter((instance) => !projectIds || projectIds.has(instance.projectId));

        return {
            maxEmulators: appConfig.emulator.maxInstances,
            emulators: emulators.map((instance) => ({
                id: instance.id,
                projectId: instance.projectId,
                avdName: instance.avdName,
                state: instance.state,
                runId: instance.runId ?? undefined,
                uptimeMs: now - instance.startedAt,
                memoryUsageMb: instance.memoryUsageMb,
            })),
            waitingRequests: projectIds
                ? this.waitQueue.filter((entry) => projectIds.has(entry.projectId)).length
                : this.waitQueue.length,
        };
    }

    getEmulatorState(id: string): EmulatorState | null {
        return this.emulators.get(id)?.state ?? null;
    }

    async installApk(handle: EmulatorHandle, apkPath: string): Promise<void> {
        const instance = this.emulators.get(handle.id);
        if (!instance) {
            throw new Error(`Emulator ${handle.id} not found`);
        }
        await instance.adb.installApk(apkPath);
    }

    async listInstalledPackages(emulatorId: string): Promise<string[]> {
        const instance = this.emulators.get(emulatorId);
        if (!instance || instance.state === 'DEAD') {
            throw new Error(`Emulator "${emulatorId}" is not available`);
        }

        const output = await instance.adb.shell('pm list packages', { timeoutMs: 30_000, retries: 1 });
        const packages = output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('package:'))
            .map((line) => line.slice('package:'.length).trim())
            .filter((line) => line.length > 0);

        return Array.from(new Set(packages)).sort((a, b) => a.localeCompare(b));
    }

    async drainAll(): Promise<void> {
        for (const instance of this.emulators.values()) {
            if (instance.state === 'IDLE') {
                await this.stopInstance(instance);
            }
        }
    }

    async killAll(): Promise<void> {
        for (const instance of this.emulators.values()) {
            await this.stopInstance(instance);
        }
    }

    private async launchEmulatorProcess(instance: EmulatorInstance): Promise<void> {
        const args = [
            '-avd', instance.avdName,
            '-port', String(instance.port),
            ...appConfig.emulator.launchArgs,
        ];

        logger.info(`Launching emulator process for ${instance.avdName} on ${instance.serial}`);

        const processHandle = spawn(this.emulatorPath, args, {
            detached: true,
            stdio: 'ignore',
        });

        const spawnReady = new Promise<void>((resolve, reject) => {
            let settled = false;
            const done = (fn: () => void) => {
                if (settled) {
                    return;
                }
                settled = true;
                fn();
            };

            processHandle.once('error', (error) => {
                done(() => reject(error));
            });

            setTimeout(() => {
                done(() => resolve());
            }, 200);
        });

        processHandle.unref();
        instance.process = processHandle;
        this.bindProcessLifecycle(instance);

        await spawnReady;
        instance.state = 'BOOTING';
    }

    private bindProcessLifecycle(instance: EmulatorInstance): void {
        const processHandle = instance.process;
        if (!processHandle) {
            return;
        }

        processHandle.once('exit', (code, signal) => {
            if (instance.state === 'DEAD' || instance.state === 'STOPPING') {
                return;
            }

            logger.warn(`Emulator process exited unexpectedly for ${instance.id} (code=${String(code)}, signal=${String(signal)})`);
            this.transitionToDead(instance);
            this.wakeNextWaiter(true);
        });
    }

    private async attachAndroidRuntime(instance: EmulatorInstance): Promise<void> {
        try {
            const module = await import('@midscene/android') as unknown as MidsceneAndroidRuntimeModule;
            const runtimeDevice = new module.AndroidDevice(instance.serial);
            await runtimeDevice.connect();

            instance.device = {
                deviceId: instance.serial,
                shell: async (command: string) => instance.adb.shell(command),
            };
            instance.agent = new module.AndroidAgent(runtimeDevice, {
                groupName: `${instance.projectId}-${instance.avdName}-${instance.port}`,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to attach Android runtime for ${instance.id}: ${message}`);
        }
    }

    private findIdleEmulator(projectId: string, avdName: string): EmulatorInstance | null {
        for (const instance of this.emulators.values()) {
            if (instance.state === 'IDLE' && instance.projectId === projectId && instance.avdName === avdName) {
                return instance;
            }
        }
        return null;
    }

    private lockEmulator(instance: EmulatorInstance, runId: string): EmulatorHandle {
        if (instance.idleTimer) {
            clearTimeout(instance.idleTimer);
            instance.idleTimer = null;
        }
        if (instance.healthCheckTimer) {
            clearTimeout(instance.healthCheckTimer);
            instance.healthCheckTimer = null;
        }

        instance.state = 'ACQUIRED';
        instance.runId = runId;
        instance.acquiredAt = Date.now();

        const forceReclaimMs = appConfig.test.maxDuration * 1000 + 60_000;
        instance.forceReclaimTimer = setTimeout(async () => {
            logger.warn(`Force-reclaiming stuck emulator ${instance.id} from run ${instance.runId}`);
            await this.stopInstance(instance);
        }, forceReclaimMs);

        return this.makeHandle(instance);
    }

    private makeHandle(instance: EmulatorInstance): EmulatorHandle {
        return {
            id: instance.id,
            projectId: instance.projectId,
            avdName: instance.avdName,
            state: instance.state,
            device: instance.device,
            agent: instance.agent,
            acquiredAt: instance.acquiredAt ?? Date.now(),
            runId: instance.runId ?? '',
        };
    }

    private async waitForBoot(instance: EmulatorInstance): Promise<void> {
        const pollMs = 3000;
        while (true) {
            await this.sleep(pollMs);
            if (instance.state === 'DEAD') {
                throw new Error(`Emulator ${instance.id} died during boot`);
            }

            try {
                const bootCompleted = await instance.adb.shell('getprop sys.boot_completed', {
                    timeoutMs: 5000,
                    retries: 1,
                });

                if (bootCompleted.trim() === '1') {
                    const health = await instance.adb.healthCheck();
                    if (health.healthy) {
                        return;
                    }
                }
            } catch {
                // Keep waiting until boot completes.
            }
        }
    }

    private async cleanEmulator(instance: EmulatorInstance, packageName?: string): Promise<boolean> {
        try {
            if (packageName) {
                await instance.adb.shell(`am force-stop ${packageName}`, { timeoutMs: 15_000, retries: 1 }).catch(() => {});
                await instance.adb.shell(`pm clear ${packageName}`, { timeoutMs: 15_000, retries: 1 }).catch(() => {});
            }
            await instance.adb.shell('input keyevent KEYCODE_HOME', { timeoutMs: 15_000, retries: 1 }).catch(() => {});
            await instance.adb.shell('am kill-all', { timeoutMs: 15_000, retries: 1 }).catch(() => {});

            const health = await instance.adb.healthCheck();
            return health.healthy;
        } catch (error) {
            logger.warn(`Failed to clean emulator ${instance.id}`, error);
            return false;
        }
    }

    private transitionToDead(instance: EmulatorInstance): void {
        this.clearInstanceTimers(instance);
        instance.state = 'DEAD';
        instance.process = null;
        instance.device = null;
        instance.agent = null;
        this.usedPorts.delete(instance.port);
        this.emulators.delete(instance.id);
        logger.info(`Emulator ${instance.id} is DEAD`);
    }

    private async stopInstance(instance: EmulatorInstance): Promise<void> {
        if (instance.state === 'DEAD') {
            return;
        }

        this.clearInstanceTimers(instance);
        instance.state = 'STOPPING';

        try {
            await execFileAsync(this.adbPath, ['-s', instance.serial, 'emu', 'kill']).catch(() => {});

            if (instance.process?.pid) {
                const killTarget = process.platform === 'win32' ? instance.process.pid : -instance.process.pid;
                try {
                    process.kill(killTarget, 'SIGTERM');
                } catch {
                    // Process may have already exited.
                }
            }
        } catch (error) {
            logger.warn(`Error stopping emulator ${instance.id}`, error);
        }

        this.transitionToDead(instance);
    }

    private clearInstanceTimers(instance: EmulatorInstance): void {
        if (instance.idleTimer) {
            clearTimeout(instance.idleTimer);
            instance.idleTimer = null;
        }
        if (instance.healthCheckTimer) {
            clearTimeout(instance.healthCheckTimer);
            instance.healthCheckTimer = null;
        }
        if (instance.forceReclaimTimer) {
            clearTimeout(instance.forceReclaimTimer);
            instance.forceReclaimTimer = null;
        }
    }

    private scheduleIdleTimeout(instance: EmulatorInstance): void {
        if (instance.idleTimer) {
            clearTimeout(instance.idleTimer);
        }

        instance.idleTimer = setTimeout(async () => {
            if (instance.state === 'IDLE') {
                logger.info(`Emulator ${instance.id} stopped after ${appConfig.emulator.idleTimeoutMs}ms idle`);
                await this.stopInstance(instance);
            }
        }, appConfig.emulator.idleTimeoutMs);
    }

    private scheduleHealthCheck(instance: EmulatorInstance): void {
        if (instance.healthCheckTimer) {
            clearTimeout(instance.healthCheckTimer);
        }

        instance.healthCheckTimer = setTimeout(async () => {
            if (instance.state !== 'IDLE') {
                return;
            }

            const result = await instance.adb.healthCheck();
            if (!result.healthy) {
                logger.warn(`Emulator ${instance.id} failed health check, attempting reconnect`);
                const reconnected = await instance.adb.reconnect();
                if (!reconnected) {
                    logger.error(`Emulator ${instance.id} unrecoverable, stopping`);
                    await this.stopInstance(instance);
                    return;
                }
            }

            this.scheduleHealthCheck(instance);
        }, appConfig.emulator.healthCheckIntervalMs);
    }

    private wakeNextWaiter(bootReplacementIfNeeded = false): void {
        if (this.waitQueue.length === 0) {
            return;
        }

        for (let index = 0; index < this.waitQueue.length; index++) {
            const entry = this.waitQueue[index];
            const idle = this.findIdleEmulator(entry.projectId, entry.avdName);
            if (!idle) {
                continue;
            }

            this.waitQueue.splice(index, 1);
            clearTimeout(entry.timeoutId);
            try {
                entry.resolve(this.lockEmulator(idle, entry.runId));
            } catch (error) {
                entry.reject(error instanceof Error ? error : new Error(String(error)));
            }
            return;
        }

        if (!bootReplacementIfNeeded) {
            return;
        }

        const entry = this.waitQueue[0];
        const activeCount = Array.from(this.emulators.values()).filter((emulator) => emulator.state !== 'DEAD').length;
        if (activeCount >= appConfig.emulator.maxInstances) {
            return;
        }

        this.waitQueue.shift();
        clearTimeout(entry.timeoutId);

        this.bootWithRetries(entry.projectId, entry.avdName, entry.signal)
            .then((handle) => {
                const instance = this.emulators.get(handle.id);
                if (!instance) {
                    entry.reject(new Error(`Replacement emulator ${handle.id} disappeared after boot`));
                    return;
                }
                entry.resolve(this.lockEmulator(instance, entry.runId));
            })
            .catch((error) => {
                entry.reject(error instanceof Error ? error : new Error(String(error)));
            });
    }

    private async bootWithRetries(projectId: string, avdName: string, signal?: AbortSignal): Promise<EmulatorHandle> {
        const maxAttempts = Math.max(1, appConfig.emulator.bootMaxAttempts);
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (signal?.aborted) {
                throw new Error('Acquisition cancelled');
            }

            try {
                return await this.boot(projectId, avdName);
            } catch (error) {
                lastError = error;
                logger.warn(`Emulator boot attempt ${attempt}/${maxAttempts} failed for AVD ${avdName}`, error);

                if (attempt < maxAttempts) {
                    await this.sleep(appConfig.emulator.bootRetryDelayMs);
                }
            }
        }

        throw new Error(
            `Failed to boot emulator for AVD "${avdName}" after ${maxAttempts} attempt(s): ` +
            `${lastError instanceof Error ? lastError.message : String(lastError)}`
        );
    }

    private async allocatePort(): Promise<number | null> {
        const adbUsedPorts = await this.getAdbEmulatorPorts();

        for (
            let port = appConfig.emulator.basePort;
            port < appConfig.emulator.basePort + appConfig.emulator.portRange;
            port += 2
        ) {
            if (this.usedPorts.has(port)) {
                continue;
            }
            if (adbUsedPorts.has(port)) {
                continue;
            }
            return port;
        }

        return null;
    }

    private async getAdbEmulatorPorts(): Promise<Set<number>> {
        const ports = new Set<number>();
        try {
            const { stdout } = await execFileAsync(this.adbPath, ['devices']);
            const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
            for (const line of lines) {
                const match = line.match(/^emulator-(\d+)\s+/);
                if (!match) {
                    continue;
                }
                const port = Number.parseInt(match[1], 10);
                if (Number.isFinite(port)) {
                    ports.add(port);
                }
            }
        } catch (error) {
            logger.warn('Failed to inspect ADB emulator ports', error);
        }

        return ports;
    }

    private async ensureAdbServer(): Promise<void> {
        try {
            await execFileAsync(this.adbPath, ['kill-server']).catch(() => {});
            await execFileAsync(this.adbPath, ['start-server']);
            logger.info('ADB server started');
        } catch (error) {
            logger.warn('Failed to restart ADB server', error);
        }
    }

    private async reclaimStaleBootingInstances(): Promise<void> {
        const maxBootAgeMs = appConfig.emulator.bootTimeoutMs + appConfig.emulator.bootRetryDelayMs;
        const now = Date.now();
        const staleInstances = Array.from(this.emulators.values()).filter((instance) =>
            (instance.state === 'STARTING' || instance.state === 'BOOTING') &&
            now - instance.startedAt > maxBootAgeMs
        );

        for (const instance of staleInstances) {
            logger.warn(`Reclaiming stale emulator ${instance.id} in state ${instance.state}`);
            await this.stopInstance(instance);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

export const emulatorPool = EmulatorPool.getInstance();

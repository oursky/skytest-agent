import { spawn, ChildProcess, execFile } from 'node:child_process';
import { config as appConfig } from '@/config/app';
import { createLogger } from './logger';
import { ReliableAdb } from './adb-reliable';
import type { AndroidDevice, AndroidAgent } from '@/types/android';

const logger = createLogger('emulator-pool');

export type EmulatorState = 'BOOTING' | 'IDLE' | 'ACQUIRED' | 'CLEANING' | 'STOPPING' | 'DEAD';

export interface EmulatorHandle {
    id: string;
    avdName: string;
    state: EmulatorState;
    device: AndroidDevice | null;
    agent: AndroidAgent | null;
    acquiredAt: number;
    runId: string;
    packageName?: string;
}

export interface EmulatorPoolStatus {
    maxEmulators: number;
    emulators: Array<{
        id: string;
        avdName: string;
        state: EmulatorState;
        runId?: string;
        uptimeMs: number;
        memoryUsageMb?: number;
    }>;
    waitingRequests: number;
}

interface WaitQueueEntry {
    avdName: string;
    runId: string;
    resolve: (handle: EmulatorHandle) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
    signal?: AbortSignal;
}

interface EmulatorInstance {
    id: string;
    avdName: string;
    state: EmulatorState;
    port: number;
    process: ChildProcess | null;
    pid: number | null;
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

function execFileAsync(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve({ stdout: String(stdout), stderr: String(stderr) });
        });
    });
}

export class EmulatorPool {
    private static instance: EmulatorPool;
    private emulators: Map<string, EmulatorInstance> = new Map();
    private waitQueue: WaitQueueEntry[] = [];
    private usedPorts: Set<number> = new Set();

    private constructor() {}

    static getInstance(): EmulatorPool {
        if (!EmulatorPool.instance) {
            EmulatorPool.instance = new EmulatorPool();
        }
        return EmulatorPool.instance;
    }

    async initialize(): Promise<void> {
        await this.ensureAdbServer();
        await this.cleanupOrphans();
    }

    async boot(avdName: string): Promise<EmulatorHandle> {
        const port = this.allocatePort();
        if (port === null) {
            throw new Error('No available ports for emulator');
        }

        const id = `emulator-${port}`;
        const adb = new ReliableAdb(id);

        const instance: EmulatorInstance = {
            id,
            avdName,
            state: 'BOOTING',
            port,
            process: null,
            pid: null,
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

        const emulatorBin = process.env.ANDROID_HOME
            ? `${process.env.ANDROID_HOME}/emulator/emulator`
            : 'emulator';

        const launchArgs: string[] = [
            '-avd', avdName,
            '-port', String(port),
            '-no-snapshot-save',
            '-gpu', appConfig.emulator.gpu,
            '-memory', String(appConfig.emulator.memory),
            '-cores', String(appConfig.emulator.cores),
        ];

        if (appConfig.emulator.headless) {
            launchArgs.push('-no-window', '-no-audio', '-no-boot-anim');
        }

        logger.info(`Booting emulator ${id} (AVD: ${avdName})`);

        const proc = spawn(emulatorBin, launchArgs, { detached: false, stdio: 'ignore' });
        instance.process = proc;
        instance.pid = proc.pid ?? null;

        proc.on('exit', (code) => {
            logger.info(`Emulator ${id} process exited with code ${code}`);
            if (instance.state !== 'STOPPING' && instance.state !== 'DEAD') {
                this.transitionToDead(instance);
            }
        });

        try {
            await Promise.race([
                this.waitForBoot(instance),
                new Promise<never>((_, reject) =>
                    setTimeout(
                        () => reject(new Error(`Emulator ${id} boot timed out (${appConfig.emulator.bootTimeoutMs}ms)`)),
                        appConfig.emulator.bootTimeoutMs
                    )
                ),
            ]);
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

    async acquire(avdName: string, runId: string, signal?: AbortSignal): Promise<EmulatorHandle> {
        if (signal?.aborted) throw new Error('Acquisition cancelled');

        const idleEmulator = this.findIdleEmulator(avdName);
        if (idleEmulator) {
            return this.lockEmulator(idleEmulator, runId);
        }

        const activeCount = Array.from(this.emulators.values()).filter(e => e.state !== 'DEAD').length;

        if (activeCount < appConfig.emulator.maxInstances) {
            const handle = await this.boot(avdName);
            const instance = this.emulators.get(handle.id);
            if (!instance) throw new Error(`Emulator ${handle.id} disappeared after boot`);
            return this.lockEmulator(instance, runId);
        }

        return new Promise<EmulatorHandle>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const idx = this.waitQueue.findIndex(e => e.timeoutId === timeoutId);
                if (idx !== -1) this.waitQueue.splice(idx, 1);
                reject(new Error(
                    `No emulator available within ${appConfig.emulator.acquireTimeoutMs / 1000}s. ` +
                    `All ${appConfig.emulator.maxInstances} emulators are in use.`
                ));
            }, appConfig.emulator.acquireTimeoutMs);

            const entry: WaitQueueEntry = { avdName, runId, resolve, reject, timeoutId, signal };

            if (signal) {
                signal.addEventListener('abort', () => {
                    const idx = this.waitQueue.findIndex(e => e === entry);
                    if (idx !== -1) {
                        this.waitQueue.splice(idx, 1);
                        clearTimeout(timeoutId);
                        reject(new Error('Acquisition cancelled'));
                    }
                }, { once: true });
            }

            this.waitQueue.push(entry);
        });
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
        instance.agent = null;
        logger.info(`Cleaning emulator ${instance.id}`);

        const cleanSuccess = await this.cleanEmulator(instance, handle.packageName);

        if (cleanSuccess) {
            instance.state = 'IDLE';
            this.scheduleIdleTimeout(instance);
            this.scheduleHealthCheck(instance);
            logger.info(`Emulator ${instance.id} returned to IDLE`);
            this.wakeNextWaiter();
        } else {
            logger.warn(`Emulator ${instance.id} cleaning failed, stopping`);
            await this.stopInstance(instance);
            this.wakeNextWaiter(true);
        }
    }

    async stop(emulatorId: string): Promise<void> {
        const instance = this.emulators.get(emulatorId);
        if (!instance) return;
        await this.stopInstance(instance);
    }

    getStatus(): EmulatorPoolStatus {
        const now = Date.now();
        return {
            maxEmulators: appConfig.emulator.maxInstances,
            emulators: Array.from(this.emulators.values())
                .filter(e => e.state !== 'DEAD')
                .map(e => ({
                    id: e.id,
                    avdName: e.avdName,
                    state: e.state,
                    runId: e.runId ?? undefined,
                    uptimeMs: now - e.startedAt,
                    memoryUsageMb: e.memoryUsageMb,
                })),
            waitingRequests: this.waitQueue.length,
        };
    }

    getEmulatorState(id: string): EmulatorState | null {
        return this.emulators.get(id)?.state ?? null;
    }

    setEmulatorAgent(id: string, agent: AndroidAgent): void {
        const instance = this.emulators.get(id);
        if (instance) instance.agent = agent;
    }

    setEmulatorDevice(id: string, device: AndroidDevice): void {
        const instance = this.emulators.get(id);
        if (instance) instance.device = device;
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

    private findIdleEmulator(avdName: string): EmulatorInstance | null {
        for (const instance of this.emulators.values()) {
            if (instance.state === 'IDLE' && instance.avdName === avdName) {
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
            if (instance.state === 'DEAD') throw new Error(`Emulator ${instance.id} died during boot`);
            try {
                const bootCompleted = await instance.adb.shell('getprop sys.boot_completed', {
                    timeoutMs: 5000,
                    retries: 1,
                });
                if (bootCompleted.trim() === '1') {
                    const health = await instance.adb.healthCheck();
                    if (health.healthy) return;
                }
            } catch {
                // Not ready yet, keep polling
            }
        }
    }

    private async cleanEmulator(instance: EmulatorInstance, packageName?: string): Promise<boolean> {
        const adb = instance.adb;
        try {
            if (packageName) {
                await adb.shell(`am force-stop ${packageName}`, { timeoutMs: 15_000, retries: 1 }).catch(() => {});
                const uninstallResult = await adb.shell(`pm uninstall ${packageName}`, { timeoutMs: 15_000, retries: 1 }).catch(() => 'failed');
                if (String(uninstallResult).includes('failed')) {
                    await adb.shell(`pm clear ${packageName}`, { timeoutMs: 15_000, retries: 1 }).catch(() => {});
                }
            }
            await adb.shell('input keyevent KEYCODE_HOME', { timeoutMs: 15_000, retries: 1 });
            await adb.shell('am kill-all', { timeoutMs: 15_000, retries: 1 });
            const health = await adb.healthCheck();
            return health.healthy;
        } catch (error) {
            logger.error(`Emulator ${instance.id} clean failed`, error);
            return false;
        }
    }

    private transitionToDead(instance: EmulatorInstance): void {
        this.clearInstanceTimers(instance);
        instance.state = 'DEAD';
        this.usedPorts.delete(instance.port);
        this.emulators.delete(instance.id);
        logger.info(`Emulator ${instance.id} is DEAD`);
    }

    private async stopInstance(instance: EmulatorInstance): Promise<void> {
        if (instance.state === 'DEAD') return;
        this.clearInstanceTimers(instance);
        instance.state = 'STOPPING';

        try {
            await execFileAsync('adb', ['-s', instance.id, 'emu', 'kill']).catch(() => {});
            if (instance.process && !instance.process.killed) {
                instance.process.kill('SIGTERM');
                await this.sleep(2000);
                if (!instance.process.killed) {
                    instance.process.kill('SIGKILL');
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
        if (instance.idleTimer) clearTimeout(instance.idleTimer);
        instance.idleTimer = setTimeout(async () => {
            if (instance.state === 'IDLE') {
                logger.info(`Emulator ${instance.id} stopped after ${appConfig.emulator.idleTimeoutMs}ms idle`);
                await this.stopInstance(instance);
            }
        }, appConfig.emulator.idleTimeoutMs);
    }

    private scheduleHealthCheck(instance: EmulatorInstance): void {
        if (instance.healthCheckTimer) clearTimeout(instance.healthCheckTimer);
        instance.healthCheckTimer = setTimeout(async () => {
            if (instance.state !== 'IDLE') return;
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
        if (this.waitQueue.length === 0) return;

        const entry = this.waitQueue[0];
        const idle = this.findIdleEmulator(entry.avdName);

        if (idle) {
            this.waitQueue.shift();
            clearTimeout(entry.timeoutId);
            try {
                entry.resolve(this.lockEmulator(idle, entry.runId));
            } catch (err) {
                entry.reject(err instanceof Error ? err : new Error(String(err)));
            }
            return;
        }

        if (!bootReplacementIfNeeded) return;

        const activeCount = Array.from(this.emulators.values()).filter(e => e.state !== 'DEAD').length;
        if (activeCount >= appConfig.emulator.maxInstances) return;

        this.waitQueue.shift();
        clearTimeout(entry.timeoutId);

        this.boot(entry.avdName)
            .then(handle => {
                const instance = this.emulators.get(handle.id);
                if (instance) {
                    entry.resolve(this.lockEmulator(instance, entry.runId));
                } else {
                    entry.reject(new Error(`Replacement emulator ${handle.id} disappeared after boot`));
                }
            })
            .catch(err => {
                entry.reject(err instanceof Error ? err : new Error(String(err)));
            });
    }

    private allocatePort(): number | null {
        for (
            let port = appConfig.emulator.basePort;
            port < appConfig.emulator.basePort + appConfig.emulator.portRange;
            port += 2
        ) {
            if (!this.usedPorts.has(port)) return port;
        }
        return null;
    }

    private async ensureAdbServer(): Promise<void> {
        try {
            await execFileAsync('adb', ['kill-server']).catch(() => {});
            await execFileAsync('adb', ['start-server']);
            logger.info('ADB server started');
        } catch (error) {
            logger.warn('Failed to restart ADB server', error);
        }
    }

    private async cleanupOrphans(): Promise<void> {
        try {
            const { stdout } = await execFileAsync('adb', ['devices']);
            const lines = stdout.split('\n').slice(1);
            for (const line of lines) {
                const [deviceId] = line.trim().split(/\s+/);
                if (deviceId?.startsWith('emulator-')) {
                    logger.info(`Killing orphan emulator ${deviceId}`);
                    await execFileAsync('adb', ['-s', deviceId, 'emu', 'kill']).catch(() => {});
                }
            }
        } catch (error) {
            logger.warn('Failed to cleanup orphan emulators', error);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const emulatorPool = EmulatorPool.getInstance();

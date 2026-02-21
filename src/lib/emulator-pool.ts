import { spawn, ChildProcess, execFile } from 'node:child_process';
import { config as appConfig } from '@/config/app';
import { createLogger } from './logger';
import { ReliableAdb } from './adb-reliable';
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
    dockerImage?: string;
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
    process: ChildProcess | null;
    pid: number | null;
    containerId: string | null;
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

        if (appConfig.emulator.docker.enabled) {
            await this.prePullDockerImages();
        }
    }

    async boot(projectId: string, avdName: string, dockerImage?: string): Promise<EmulatorHandle> {
        const port = this.allocatePort();
        if (port === null) {
            throw new Error('No available ports for emulator');
        }

        const containerName = `${appConfig.emulator.docker.containerNamePrefix}${port}`;
        const id = appConfig.emulator.docker.enabled && dockerImage ? containerName : `emulator-${port}`;
        const adbSerial = appConfig.emulator.docker.enabled && dockerImage ? `localhost:${port}` : `emulator-${port}`;
        const adb = new ReliableAdb(adbSerial);

        const instance: EmulatorInstance = {
            id,
            projectId,
            avdName,
            state: appConfig.emulator.docker.enabled && dockerImage ? 'STARTING' : 'BOOTING',
            port,
            process: null,
            pid: null,
            containerId: null,
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

        if (appConfig.emulator.docker.enabled && dockerImage) {
            await this.bootDockerContainer(instance, dockerImage, port, containerName);
        } else {
            this.bootNativeEmulator(instance, avdName, port);
        }

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

    async acquire(projectId: string, avdName: string, runId: string, dockerImage?: string, signal?: AbortSignal): Promise<EmulatorHandle> {
        if (signal?.aborted) throw new Error('Acquisition cancelled');

        const idleEmulator = this.findIdleEmulator(projectId, avdName);
        if (idleEmulator) {
            return this.lockEmulator(idleEmulator, runId);
        }

        const activeCount = Array.from(this.emulators.values()).filter(e => e.state !== 'DEAD').length;

        if (activeCount < appConfig.emulator.maxInstances) {
            const handle = await this.bootWithRetries(projectId, avdName, dockerImage, signal);
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

            const entry: WaitQueueEntry = { projectId, avdName, runId, dockerImage, resolve, reject, timeoutId, signal };

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
        logger.info(`Releasing emulator ${instance.id}`);

        await this.stopInstance(instance);
        this.wakeNextWaiter(true);
    }

    async stop(emulatorId: string): Promise<void> {
        const instance = this.emulators.get(emulatorId);
        if (!instance) return;
        await this.stopInstance(instance);
    }

    getStatus(projectIds?: ReadonlySet<string>): EmulatorPoolStatus {
        const now = Date.now();
        const filteredEmulators = Array.from(this.emulators.values())
            .filter(e => e.state !== 'DEAD')
            .filter(e => !projectIds || projectIds.has(e.projectId));

        return {
            maxEmulators: appConfig.emulator.maxInstances,
            emulators: filteredEmulators.map(e => ({
                    id: e.id,
                    projectId: e.projectId,
                    avdName: e.avdName,
                    state: e.state,
                    runId: e.runId ?? undefined,
                    uptimeMs: now - e.startedAt,
                    memoryUsageMb: e.memoryUsageMb,
                })),
            waitingRequests: projectIds
                ? this.waitQueue.filter(entry => projectIds.has(entry.projectId)).length
                : this.waitQueue.length,
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

    async installApk(handle: EmulatorHandle, apkPath: string): Promise<void> {
        const instance = this.emulators.get(handle.id);
        if (!instance) {
            throw new Error(`Emulator ${handle.id} not found`);
        }
        await instance.adb.installApk(apkPath);
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
            if (instance.containerId) {
                await execFileAsync('docker', ['stop', instance.containerId]).catch(() => {});
                await execFileAsync('docker', ['rm', instance.containerId]).catch(() => {});
            } else {
                await execFileAsync('adb', ['-s', instance.id, 'emu', 'kill']).catch(() => {});
                if (instance.process && !instance.process.killed) {
                    instance.process.kill('SIGTERM');
                    await this.sleep(2000);
                    if (!instance.process.killed) {
                        instance.process.kill('SIGKILL');
                    }
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
        const idle = this.findIdleEmulator(entry.projectId, entry.avdName);

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

        this.bootWithRetries(entry.projectId, entry.avdName, entry.dockerImage, entry.signal)
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

    private async bootWithRetries(
        projectId: string,
        avdName: string,
        dockerImage?: string,
        signal?: AbortSignal
    ): Promise<EmulatorHandle> {
        const maxAttempts = Math.max(1, appConfig.emulator.bootMaxAttempts);
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (signal?.aborted) throw new Error('Acquisition cancelled');

            try {
                return await this.boot(projectId, avdName, dockerImage);
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

        if (appConfig.emulator.docker.enabled) {
            try {
                const prefix = appConfig.emulator.docker.containerNamePrefix;
                const { stdout } = await execFileAsync('docker', ['ps', '-a', '--filter', `name=${prefix}`, '-q']);
                const ids = stdout.trim().split('\n').filter(Boolean);
                for (const cid of ids) {
                    logger.info(`Removing orphan Docker container ${cid}`);
                    await execFileAsync('docker', ['stop', cid]).catch(() => {});
                    await execFileAsync('docker', ['rm', cid]).catch(() => {});
                }
            } catch (error) {
                logger.warn('Failed to cleanup orphan Docker containers', error);
            }
        }
    }

    private bootNativeEmulator(instance: EmulatorInstance, avdName: string, port: number): void {
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

        logger.info(`Booting native emulator ${instance.id} (AVD: ${avdName})`);

        const proc = spawn(emulatorBin, launchArgs, { detached: false, stdio: 'ignore' });
        instance.process = proc;
        instance.pid = proc.pid ?? null;
        instance.state = 'BOOTING';

        proc.on('exit', (code) => {
            logger.info(`Emulator ${instance.id} process exited with code ${code}`);
            if (instance.state !== 'STOPPING' && instance.state !== 'DEAD') {
                this.transitionToDead(instance);
            }
        });
    }

    private async bootDockerContainer(instance: EmulatorInstance, dockerImage: string, port: number, containerName: string): Promise<void> {
        logger.info(`Starting Docker container ${containerName} for image ${dockerImage} on port ${port}`);

        const { stdout } = await execFileAsync('docker', [
            'run', '-d',
            '--name', containerName,
            '--device', '/dev/kvm',
            '-p', `${port}:5555`,
            '-e', 'EMULATOR_NO_BOOT_ANIM=1',
            dockerImage,
        ]);

        const containerId = stdout.trim();
        instance.containerId = containerId;
        instance.state = 'BOOTING';
        logger.info(`Docker container started`, { containerId, containerName, port });
    }

    private async prePullDockerImages(): Promise<void> {
        try {
            const { listAvailableAndroidProfiles } = await import('@/lib/android-profiles');
            const profiles = await listAvailableAndroidProfiles();
            const images = [...new Set(profiles.map(profile => profile.dockerImage).filter(Boolean))] as string[];
            for (const image of images) {
                logger.info(`Pulling Docker image: ${image}`);
                await execFileAsync('docker', ['pull', image]).catch((err) => {
                    logger.warn(`Failed to pull Docker image ${image}`, err);
                });
            }
        } catch (error) {
            logger.warn('Failed to pre-pull Docker images', error);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export const emulatorPool = EmulatorPool.getInstance();

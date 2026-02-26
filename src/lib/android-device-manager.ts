import { createLogger } from '@/lib/logger';
import { emulatorPool, type EmulatorHandle, type EmulatorPoolStatusItem, type EmulatorState } from '@/lib/emulator-pool';
import { ReliableAdb } from '@/lib/adb-reliable';
import { resolveAndroidToolPath } from '@/lib/android-sdk';
import { listConnectedAndroidDevices } from '@/lib/android-devices';
import type { AndroidAgent, AndroidDevice, AndroidDeviceSelector } from '@/types';

const logger = createLogger('android-device-manager');

type DeviceLeaseState = EmulatorState;
type ManagedDeviceKind = 'emulator' | 'physical';

export interface AndroidDeviceLease {
    id: string;
    kind: ManagedDeviceKind;
    currentProjectId?: string;
    emulatorProfileName?: string;
    serial: string;
    state: DeviceLeaseState;
    device: AndroidDevice | null;
    agent: AndroidAgent | null;
    acquiredAt: number;
    runId: string;
    packageName?: string;
    clearPackageDataOnRelease?: boolean;
}

export interface AndroidDevicePoolStatusItem {
    id: string;
    kind: ManagedDeviceKind;
    serial: string;
    emulatorProfileName?: string;
    currentProjectId?: string;
    state: DeviceLeaseState;
    runId?: string;
    runProjectId?: string;
    runTestCaseId?: string;
    runTestCaseName?: string;
    runTestCaseDisplayId?: string;
    uptimeMs: number;
    memoryUsageMb?: number;
}

export interface AndroidDevicePoolStatus {
    devices: AndroidDevicePoolStatusItem[];
}

export interface AndroidDeviceAcquireProbeRequest {
    projectId: string;
    selector: AndroidDeviceSelector;
}

interface BootOptions {
    headless?: boolean;
}

interface PhysicalLeaseInstance {
    id: string;
    serial: string;
    state: DeviceLeaseState;
    adb: ReliableAdb;
    device: AndroidDevice | null;
    agent: AndroidAgent | null;
    currentProjectId: string | null;
    runId: string | null;
    startedAt: number;
    acquiredAt: number | null;
}

interface MidsceneAndroidDevice {
    connect(): Promise<void>;
    screenshotBase64?(): Promise<string>;
}

interface MidsceneAndroidDeviceConstructor {
    new (
        udid: string,
        options?: { imeStrategy?: 'always-yadb' | 'yadb-for-non-ascii' }
    ): MidsceneAndroidDevice;
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

function listPackagesFromPmList(output: string): string[] {
    return Array.from(new Set(
        output
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('package:'))
            .map((line) => line.slice('package:'.length).trim())
            .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
}

export class AndroidDeviceManager {
    private static instance: AndroidDeviceManager;
    private readonly adbPath: string;
    private physicalLeases = new Map<string, PhysicalLeaseInstance>();

    private constructor() {
        this.adbPath = resolveAndroidToolPath('adb');
    }

    static getInstance(): AndroidDeviceManager {
        if (!AndroidDeviceManager.instance) {
            AndroidDeviceManager.instance = new AndroidDeviceManager();
        }
        return AndroidDeviceManager.instance;
    }

    async initialize(): Promise<void> {
        await emulatorPool.initialize();
    }

    getStatus(projectIds?: ReadonlySet<string>): AndroidDevicePoolStatus {
        const emulatorStatus = emulatorPool.getStatus(projectIds);
        const now = Date.now();

        const devices: AndroidDevicePoolStatusItem[] = emulatorStatus.emulators.map((item) => this.mapEmulatorStatusItem(item));

        for (const instance of this.physicalLeases.values()) {
            if (instance.state === 'DEAD') {
                continue;
            }
            devices.push({
                id: instance.id,
                kind: 'physical',
                serial: instance.serial,
                currentProjectId: instance.currentProjectId ?? undefined,
                state: instance.state,
                runId: instance.runId ?? undefined,
                uptimeMs: now - instance.startedAt,
            });
        }

        return {
            devices,
        };
    }

    async canAcquireBatchImmediately(requests: ReadonlyArray<AndroidDeviceAcquireProbeRequest>): Promise<boolean> {
        if (requests.length === 0) {
            return true;
        }

        const emulatorRequests = requests
            .flatMap((request) => {
                if (request.selector.mode !== 'emulator-profile') {
                    return [];
                }
                return [{
                    projectId: request.projectId,
                    avdName: request.selector.emulatorProfileName,
                }];
            });

        if (emulatorRequests.length > 0) {
            const emulatorReady = await emulatorPool.canAcquireBatchImmediately(emulatorRequests);
            if (!emulatorReady) {
                return false;
            }
        }

        const reservedPhysicalSerials = new Set<string>();
        for (const request of requests) {
            if (request.selector.mode !== 'connected-device') {
                continue;
            }

            const serial = request.selector.serial;
            if (!serial) {
                return false;
            }

            if (reservedPhysicalSerials.has(serial)) {
                return false;
            }

            const existing = this.physicalLeases.get(serial);
            if (existing && existing.state === 'ACQUIRED') {
                return false;
            }

            reservedPhysicalSerials.add(serial);
        }

        return true;
    }

    async boot(projectId: string | null, emulatorProfileName: string, options?: BootOptions): Promise<AndroidDeviceLease> {
        const handle = await emulatorPool.boot(projectId, emulatorProfileName, options);
        return this.fromEmulatorHandle(handle);
    }

    async acquire(
        projectId: string,
        selector: AndroidDeviceSelector,
        runId: string,
        signal?: AbortSignal
    ): Promise<AndroidDeviceLease> {
        if (selector.mode === 'emulator-profile') {
            const handle = await emulatorPool.acquire(projectId, selector.emulatorProfileName, runId, signal);
            return this.fromEmulatorHandle(handle);
        }

        return this.acquirePhysicalDevice(projectId, selector.serial, runId, signal);
    }

    async release(handle: AndroidDeviceLease): Promise<void> {
        if (handle.kind === 'emulator') {
            await emulatorPool.release(this.toEmulatorHandle(handle));
            return;
        }

        const instance = this.physicalLeases.get(handle.serial);
        if (!instance) {
            return;
        }

        if (instance.state !== 'ACQUIRED') {
            return;
        }

        instance.state = 'CLEANING';
        let cleanupFailed = false;

        if (handle.packageName && handle.clearPackageDataOnRelease !== false) {
            try {
                await instance.adb.shell(`am force-stop ${handle.packageName}`, { timeoutMs: 15_000, retries: 1 });
            } catch (error) {
                cleanupFailed = true;
                logger.warn(`Failed to force-stop app on device "${instance.serial}" during release`, error);
            }
            try {
                await instance.adb.shell(`pm clear ${handle.packageName}`, { timeoutMs: 15_000, retries: 1 });
            } catch (error) {
                cleanupFailed = true;
                logger.warn(`Failed to clear app data on device "${instance.serial}" during release`, error);
            }
        }

        try {
            await instance.adb.shell('input keyevent KEYCODE_HOME', { timeoutMs: 15_000, retries: 1 });
        } catch (error) {
            cleanupFailed = true;
            logger.warn(`Failed to send HOME keyevent on device "${instance.serial}" during release`, error);
        }

        if (!cleanupFailed) {
            try {
                const health = await instance.adb.healthCheck();
                if (!health.healthy) {
                    cleanupFailed = true;
                    logger.warn(`Device "${instance.serial}" failed health check during release; discarding lease`, health);
                }
            } catch (error) {
                cleanupFailed = true;
                logger.warn(`Failed to health-check device "${instance.serial}" during release`, error);
            }
        }

        if (cleanupFailed) {
            this.discardPhysicalLease(instance);
            return;
        }

        instance.currentProjectId = null;
        instance.runId = null;
        instance.acquiredAt = null;
        instance.state = 'IDLE';
    }

    async stop(deviceId: string): Promise<void> {
        if (this.physicalLeases.has(deviceId)) {
            throw new Error('Stopping connected physical devices is not supported');
        }

        await emulatorPool.stop(deviceId);
    }

    async stopConnectedEmulator(serial: string): Promise<void> {
        const trimmedSerial = serial.trim();
        if (!trimmedSerial) {
            throw new Error('Emulator serial is required');
        }
        if (!trimmedSerial.startsWith('emulator-')) {
            throw new Error('Stopping connected physical devices is not supported');
        }

        const adb = new ReliableAdb(trimmedSerial, this.adbPath);
        await adb.emulatorKill();
    }

    async listInstalledPackages(deviceIdOrSerial: string): Promise<string[]> {
        const emulatorStatus = emulatorPool.getStatus().emulators.find((item) => item.id === deviceIdOrSerial);
        if (emulatorStatus) {
            return emulatorPool.listInstalledPackages(deviceIdOrSerial);
        }

        const adb = new ReliableAdb(deviceIdOrSerial, this.adbPath);
        const output = await adb.shell('pm list packages', { timeoutMs: 30_000, retries: 1 });
        return listPackagesFromPmList(output);
    }

    private mapEmulatorStatusItem(item: EmulatorPoolStatusItem): AndroidDevicePoolStatusItem {
        return {
            id: item.id,
            kind: 'emulator',
            serial: item.id,
            emulatorProfileName: item.avdName,
            currentProjectId: item.currentProjectId,
            state: item.state,
            runId: item.runId,
            runProjectId: item.runProjectId,
            runTestCaseId: item.runTestCaseId,
            runTestCaseName: item.runTestCaseName,
            runTestCaseDisplayId: item.runTestCaseDisplayId,
            uptimeMs: item.uptimeMs,
            memoryUsageMb: item.memoryUsageMb,
        };
    }

    private fromEmulatorHandle(handle: EmulatorHandle): AndroidDeviceLease {
        return {
            id: handle.id,
            kind: 'emulator',
            currentProjectId: handle.currentProjectId,
            emulatorProfileName: handle.avdName,
            serial: handle.id,
            state: handle.state,
            device: handle.device,
            agent: handle.agent,
            acquiredAt: handle.acquiredAt,
            runId: handle.runId,
            packageName: handle.packageName,
            clearPackageDataOnRelease: handle.clearPackageDataOnRelease,
        };
    }

    private toEmulatorHandle(handle: AndroidDeviceLease): EmulatorHandle {
        return {
            id: handle.id,
            currentProjectId: handle.currentProjectId,
            avdName: handle.emulatorProfileName ?? '',
            state: handle.state,
            device: handle.device,
            agent: handle.agent,
            acquiredAt: handle.acquiredAt,
            runId: handle.runId,
            packageName: handle.packageName,
            clearPackageDataOnRelease: handle.clearPackageDataOnRelease,
        };
    }

    private async acquirePhysicalDevice(
        projectId: string,
        serial: string,
        runId: string,
        signal?: AbortSignal
    ): Promise<AndroidDeviceLease> {
        if (signal?.aborted) {
            throw new Error('Acquisition cancelled');
        }

        const trimmedSerial = serial.trim();
        if (!trimmedSerial) {
            throw new Error('Android device serial is required');
        }

        const connectedDevices = await listConnectedAndroidDevices();
        const connected = connectedDevices.find((device) => device.serial === trimmedSerial);
        if (!connected) {
            throw new Error(`Android device "${trimmedSerial}" is not connected`);
        }
        if (connected.adbState === 'unauthorized') {
            throw new Error(`Android device "${trimmedSerial}" is unauthorized. Allow USB debugging on the device and try again.`);
        }
        if (connected.adbState !== 'device') {
            throw new Error(`Android device "${trimmedSerial}" is not ready (state: ${connected.adbState})`);
        }

        let existing = this.physicalLeases.get(trimmedSerial);
        if (existing?.state === 'ACQUIRED') {
            throw new Error(`Android device "${trimmedSerial}" is already in use`);
        }

        if (existing) {
            const healthy = await this.isReusablePhysicalLeaseHealthy(existing);
            if (!healthy) {
                logger.warn(`Discarding stale physical device lease for "${trimmedSerial}" before acquisition`);
                this.discardPhysicalLease(existing);
                existing = undefined;
            }
        }

        const instance = existing ?? await this.createPhysicalLeaseInstance(trimmedSerial, projectId);

        if (existing) {
            if (!instance.device || !instance.agent) {
                await this.attachAndroidRuntime(instance, projectId);
            }
        }

        instance.state = 'ACQUIRED';
        instance.currentProjectId = projectId;
        instance.runId = runId;
        instance.acquiredAt = Date.now();

        return {
            id: instance.id,
            kind: 'physical',
            currentProjectId: projectId,
            serial: instance.serial,
            state: instance.state,
            device: instance.device,
            agent: instance.agent,
            acquiredAt: instance.acquiredAt,
            runId,
        };
    }

    private async createPhysicalLeaseInstance(serial: string, projectId: string): Promise<PhysicalLeaseInstance> {
        const instance: PhysicalLeaseInstance = {
            id: serial,
            serial,
            state: 'STARTING',
            adb: new ReliableAdb(serial, this.adbPath),
            device: null,
            agent: null,
            currentProjectId: projectId,
            runId: null,
            startedAt: Date.now(),
            acquiredAt: null,
        };

        this.physicalLeases.set(serial, instance);

        try {
            instance.state = 'BOOTING';
            await this.attachAndroidRuntime(instance, projectId);
            instance.state = 'IDLE';
            return instance;
        } catch (error) {
            this.physicalLeases.delete(serial);
            throw error;
        }
    }

    private async attachAndroidRuntime(instance: PhysicalLeaseInstance, projectId: string): Promise<void> {
        try {
            const runtimeModule = await import('@midscene/android') as unknown as MidsceneAndroidRuntimeModule;
            const runtimeDevice = new runtimeModule.AndroidDevice(instance.serial, {
                imeStrategy: 'always-yadb',
            });
            await runtimeDevice.connect();

            instance.device = {
                deviceId: instance.serial,
                shell: async (command: string) => instance.adb.shell(command),
                screenshotBase64: typeof runtimeDevice.screenshotBase64 === 'function'
                    ? async () => runtimeDevice.screenshotBase64!()
                    : undefined,
            };
            instance.agent = new runtimeModule.AndroidAgent(runtimeDevice, {
                groupName: `${projectId}-device-${instance.serial}`,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to attach Android runtime for device "${instance.serial}": ${message}`);
        }
    }

    private async isReusablePhysicalLeaseHealthy(instance: PhysicalLeaseInstance): Promise<boolean> {
        if (instance.state !== 'IDLE') {
            return false;
        }

        try {
            const health = await instance.adb.healthCheck();
            return health.healthy;
        } catch {
            return false;
        }
    }

    private discardPhysicalLease(instance: PhysicalLeaseInstance): void {
        instance.state = 'DEAD';
        instance.currentProjectId = null;
        instance.runId = null;
        instance.acquiredAt = null;
        instance.device = null;
        instance.agent = null;
        this.physicalLeases.delete(instance.serial);
    }
}

export const androidDeviceManager = AndroidDeviceManager.getInstance();

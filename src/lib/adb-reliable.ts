import { execFile } from 'node:child_process';
import { config } from '@/config/app';
import { createLogger } from './logger';

const logger = createLogger('adb-reliable');

export type AdbErrorType =
    | 'DEVICE_OFFLINE'
    | 'DEVICE_UNAUTHORIZED'
    | 'CONNECTION_RESET'
    | 'COMMAND_TIMEOUT'
    | 'DEVICE_NOT_FOUND'
    | 'INSTALL_FAILED'
    | 'UNKNOWN';

export interface HealthCheckResult {
    healthy: boolean;
    details: {
        deviceOnline: boolean;
        bootCompleted: boolean;
        screenResponsive: boolean;
        adbResponsive: boolean;
    };
    latencyMs: number;
}

type ExecError = Error & { stderr?: string; stdout?: string; code?: string | number };

function isExecError(error: unknown): error is ExecError {
    return error instanceof Error;
}

function classifyAdbError(error: unknown): AdbErrorType {
    if (isExecError(error) && error.message === 'COMMAND_TIMEOUT') {
        return 'COMMAND_TIMEOUT';
    }
    const msg = [
        isExecError(error) ? error.message : '',
        isExecError(error) ? (error.stderr ?? '') : '',
        String(error),
    ].join(' ').toLowerCase();

    if (msg.includes('device offline')) return 'DEVICE_OFFLINE';
    if (msg.includes('unauthorized')) return 'DEVICE_UNAUTHORIZED';
    if (msg.includes('connection reset') || msg.includes('econnreset') || msg.includes('broken pipe')) return 'CONNECTION_RESET';
    if (msg.includes('device not found') || msg.includes('no devices/emulators found') || msg.includes('no such device')) return 'DEVICE_NOT_FOUND';
    if (msg.includes('install_failed') || msg.includes('insufficient storage') || msg.includes('failure [')) return 'INSTALL_FAILED';
    return 'UNKNOWN';
}

function runExecFile(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                const err = error as ExecError;
                err.stderr = String(stderr);
                err.stdout = String(stdout);
                reject(err);
            } else {
                resolve({ stdout: String(stdout), stderr: String(stderr) });
            }
        });
    });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('COMMAND_TIMEOUT')), timeoutMs)
        ),
    ]);
}

export class ReliableAdb {
    private readonly deviceId: string;
    private readonly adbPath: string;

    constructor(deviceId: string, adbPath = 'adb') {
        this.deviceId = deviceId;
        this.adbPath = adbPath;
    }

    async shell(command: string, opts: {
        timeoutMs?: number;
        retries?: number;
        retryDelayMs?: number;
    } = {}): Promise<string> {
        const adbCfg = config.emulator.adb;
        const maxRetries = opts.retries ?? adbCfg.maxRetries;
        const retryDelayMs = opts.retryDelayMs ?? adbCfg.retryDelayMs;
        let timeoutMs = opts.timeoutMs ?? adbCfg.commandTimeoutMs;
        let timeoutRetried = false;

        let lastError: unknown;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const { stdout } = await withTimeout(
                    runExecFile(this.adbPath, ['-s', this.deviceId, 'shell', command]),
                    timeoutMs,
                    `adb shell ${command}`
                );
                return stdout.trim();
            } catch (error) {
                lastError = error;
                const errorType = classifyAdbError(error);
                const isLastAttempt = attempt >= maxRetries;

                if (
                    isLastAttempt ||
                    errorType === 'DEVICE_UNAUTHORIZED' ||
                    errorType === 'INSTALL_FAILED' ||
                    errorType === 'DEVICE_NOT_FOUND' ||
                    errorType === 'UNKNOWN'
                ) {
                    break;
                }

                if (errorType === 'COMMAND_TIMEOUT') {
                    if (timeoutRetried) break;
                    timeoutRetried = true;
                    timeoutMs *= 2;
                    logger.warn(`ADB command timed out for ${this.deviceId}, retrying with ${timeoutMs}ms`);
                } else if (errorType === 'DEVICE_OFFLINE' || errorType === 'CONNECTION_RESET') {
                    logger.warn(`ADB ${errorType} for ${this.deviceId}, retrying (${attempt + 1}/${maxRetries})`);
                    await this.sleep(retryDelayMs);
                    await this.reconnect().catch(() => {});
                }
            }
        }

        throw lastError ?? new Error(`ADB shell failed after ${maxRetries} retries`);
    }

    async healthCheck(): Promise<HealthCheckResult> {
        const start = Date.now();
        const details = {
            deviceOnline: false,
            bootCompleted: false,
            screenResponsive: false,
            adbResponsive: false,
        };

        try {
            const { stdout } = await withTimeout(
                runExecFile(this.adbPath, ['-s', this.deviceId, 'shell', 'echo', 'ping']),
                5000,
                'adb echo ping'
            );
            details.adbResponsive = stdout.trim() === 'ping';
            details.deviceOnline = details.adbResponsive;
        } catch {
            return { healthy: false, details, latencyMs: Date.now() - start };
        }

        try {
            const bootProp = await this.shell('getprop sys.boot_completed', { timeoutMs: 5000, retries: 0 });
            details.bootCompleted = bootProp.trim() === '1';
        } catch {
            // Not yet booted
        }

        try {
            await this.shell('screencap -p /dev/null', { timeoutMs: 10_000, retries: 0 });
            details.screenResponsive = true;
        } catch {
            // Screen not responsive
        }

        const healthy = details.adbResponsive && details.bootCompleted && details.deviceOnline;
        return { healthy, details, latencyMs: Date.now() - start };
    }

    async reconnect(): Promise<boolean> {
        try {
            await runExecFile(this.adbPath, ['disconnect', this.deviceId]).catch(() => {});
            await this.sleep(1000);
            await runExecFile(this.adbPath, ['connect', this.deviceId]);
            await this.sleep(2000);
            const result = await this.healthCheck();
            return result.healthy;
        } catch {
            return false;
        }
    }

    async emulatorKill(timeoutMs = 5000): Promise<void> {
        await withTimeout(
            runExecFile(this.adbPath, ['-s', this.deviceId, 'emu', 'kill']),
            timeoutMs,
            'adb emu kill'
        );
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

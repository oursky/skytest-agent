import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = 'skytest-agent-runner';

function resolveRunnerStateRoot(): string {
    const configuredStateRoot = process.env.SKYTEST_RUNNER_STATE_DIR?.trim();
    if (configuredStateRoot && configuredStateRoot.length > 0) {
        return configuredStateRoot;
    }
    return path.join(os.homedir(), '.skytest-agent');
}

function shouldUseKeychainStorage(): boolean {
    if (process.platform !== 'darwin') {
        return false;
    }
    if (process.env.SKYTEST_RUNNER_DISABLE_KEYCHAIN === '1') {
        return false;
    }
    return true;
}

const CREDENTIAL_FILE_PATH = path.join(resolveRunnerStateRoot(), 'runner-credential.json');

export interface StoredRunnerCredential {
    runnerToken: string;
    runnerId?: string;
    credentialExpiresAt?: string;
    updatedAt: string;
}

function keychainAccount(controlPlaneBaseUrl: string): string {
    try {
        const host = new URL(controlPlaneBaseUrl).host;
        return host.length > 0 ? host : controlPlaneBaseUrl;
    } catch {
        return controlPlaneBaseUrl;
    }
}

async function loadFromKeychain(controlPlaneBaseUrl: string): Promise<string | null> {
    if (!shouldUseKeychainStorage()) {
        return null;
    }

    try {
        const { stdout } = await execFileAsync('security', [
            'find-generic-password',
            '-s',
            KEYCHAIN_SERVICE,
            '-a',
            keychainAccount(controlPlaneBaseUrl),
            '-w',
        ]);
        const token = stdout.trim();
        return token.length > 0 ? token : null;
    } catch {
        return null;
    }
}

async function saveToKeychain(controlPlaneBaseUrl: string, runnerToken: string): Promise<void> {
    if (!shouldUseKeychainStorage()) {
        return;
    }

    await execFileAsync('security', [
        'add-generic-password',
        '-U',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        keychainAccount(controlPlaneBaseUrl),
        '-w',
        runnerToken,
    ]);
}

async function loadFromFile(): Promise<StoredRunnerCredential | null> {
    try {
        const content = await readFile(CREDENTIAL_FILE_PATH, 'utf8');
        const parsed = JSON.parse(content) as Partial<StoredRunnerCredential>;
        if (typeof parsed.runnerToken !== 'string' || parsed.runnerToken.trim().length === 0) {
            return null;
        }

        return {
            runnerToken: parsed.runnerToken,
            runnerId: typeof parsed.runnerId === 'string' ? parsed.runnerId : undefined,
            credentialExpiresAt: typeof parsed.credentialExpiresAt === 'string' ? parsed.credentialExpiresAt : undefined,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        };
    } catch {
        return null;
    }
}

async function saveToFile(credential: StoredRunnerCredential): Promise<void> {
    await mkdir(path.dirname(CREDENTIAL_FILE_PATH), { recursive: true });
    await writeFile(CREDENTIAL_FILE_PATH, JSON.stringify(credential, null, 2), 'utf8');
}

export async function loadStoredRunnerCredential(controlPlaneBaseUrl: string): Promise<StoredRunnerCredential | null> {
    const keychainToken = await loadFromKeychain(controlPlaneBaseUrl);
    if (keychainToken) {
        const fromFile = await loadFromFile();
        return {
            runnerToken: keychainToken,
            runnerId: fromFile?.runnerId,
            credentialExpiresAt: fromFile?.credentialExpiresAt,
            updatedAt: fromFile?.updatedAt ?? new Date().toISOString(),
        };
    }

    return loadFromFile();
}

export async function saveRunnerCredential(
    controlPlaneBaseUrl: string,
    credential: StoredRunnerCredential
): Promise<void> {
    await saveToKeychain(controlPlaneBaseUrl, credential.runnerToken);
    await saveToFile(credential);
}

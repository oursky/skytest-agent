import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type AndroidTool = 'adb' | 'emulator' | 'avdmanager';

const TOOL_RELATIVE_PATHS: Record<AndroidTool, string[]> = {
    adb: ['platform-tools', 'adb'],
    emulator: ['emulator', 'emulator'],
    avdmanager: ['cmdline-tools', 'latest', 'bin', 'avdmanager'],
};

let cachedSdkRoot: string | null | undefined;

function executableName(baseName: string): string {
    return process.platform === 'win32' ? `${baseName}.exe` : baseName;
}

function getSdkRootCandidates(): string[] {
    const home = os.homedir();
    const candidates = [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        path.join(home, 'Library', 'Android', 'sdk'),
        path.join(home, 'Android', 'Sdk'),
    ];
    return candidates.filter((value): value is string => Boolean(value && value.trim().length > 0));
}

export function resolveAndroidSdkRoot(): string | null {
    if (cachedSdkRoot !== undefined) {
        return cachedSdkRoot;
    }

    for (const candidate of getSdkRootCandidates()) {
        if (existsSync(candidate)) {
            cachedSdkRoot = candidate;
            return candidate;
        }
    }

    cachedSdkRoot = null;
    return null;
}

function resolveToolPathFromRoot(sdkRoot: string, tool: AndroidTool): string | null {
    const relative = TOOL_RELATIVE_PATHS[tool];
    const segments = [...relative.slice(0, -1), executableName(relative[relative.length - 1])];
    const resolved = path.join(sdkRoot, ...segments);
    return existsSync(resolved) ? resolved : null;
}

export function resolveAndroidToolPath(tool: AndroidTool): string {
    const sdkRoot = resolveAndroidSdkRoot();
    if (!sdkRoot) {
        return executableName(tool);
    }

    const toolPath = resolveToolPathFromRoot(sdkRoot, tool);
    return toolPath ?? executableName(tool);
}

export function getAndroidSdkSetupHint(): string {
    return 'Android SDK tools are not available. Install Android SDK and ensure `adb` and `emulator` are in PATH, or set ANDROID_HOME/ANDROID_SDK_ROOT.';
}


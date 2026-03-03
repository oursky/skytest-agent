import { accessSync, constants, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type AndroidTool = 'adb' | 'emulator' | 'avdmanager';

const TOOL_RELATIVE_PATHS: Record<AndroidTool, string[]> = {
    adb: ['platform-tools', 'adb'],
    emulator: ['emulator', 'emulator'],
    avdmanager: ['cmdline-tools', 'latest', 'bin', 'avdmanager'],
};

let cachedSdkRoot: string | null | undefined;
let cachedAndroidRuntimeAvailable: boolean | undefined;
let cachedAndroidAdbAvailable: boolean | undefined;
let cachedAndroidEmulatorAvailable: boolean | undefined;

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

function isExecutableFile(filePath: string): boolean {
    if (!existsSync(filePath)) {
        return false;
    }

    try {
        accessSync(filePath, constants.X_OK);
        return true;
    } catch {
        return process.platform === 'win32';
    }
}

function hasPathSeparator(value: string): boolean {
    return value.includes('/') || value.includes('\\');
}

function isExecutableInPath(command: string): boolean {
    const pathValue = process.env.PATH;
    if (!pathValue) {
        return false;
    }

    const candidates = process.platform === 'win32' && !/\.[a-z0-9]+$/i.test(command)
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT')
            .split(';')
            .filter(Boolean)
            .map((ext) => `${command}${ext}`)
        : [command];

    for (const dir of pathValue.split(path.delimiter)) {
        if (!dir) {
            continue;
        }
        for (const candidate of candidates) {
            if (isExecutableFile(path.join(dir, candidate))) {
                return true;
            }
        }
    }

    return false;
}

export function isAndroidToolAvailable(tool: AndroidTool): boolean {
    const toolPath = resolveAndroidToolPath(tool);
    if (path.isAbsolute(toolPath) || hasPathSeparator(toolPath)) {
        return isExecutableFile(toolPath);
    }
    return isExecutableInPath(toolPath);
}

export function isAndroidRuntimeAvailable(): boolean {
    if (cachedAndroidRuntimeAvailable !== undefined) {
        return cachedAndroidRuntimeAvailable;
    }

    cachedAndroidRuntimeAvailable = isAndroidAdbAvailable() && isAndroidEmulatorAvailable();
    return cachedAndroidRuntimeAvailable;
}

export function isAndroidAdbAvailable(): boolean {
    if (cachedAndroidAdbAvailable !== undefined) {
        return cachedAndroidAdbAvailable;
    }

    cachedAndroidAdbAvailable = isAndroidToolAvailable('adb');
    return cachedAndroidAdbAvailable;
}

export function isAndroidEmulatorAvailable(): boolean {
    if (cachedAndroidEmulatorAvailable !== undefined) {
        return cachedAndroidEmulatorAvailable;
    }

    cachedAndroidEmulatorAvailable = isAndroidToolAvailable('emulator');
    return cachedAndroidEmulatorAvailable;
}

export function getAndroidSdkSetupHint(): string {
    return 'Android SDK tools are not available. Install Android SDK and ensure `adb` and `emulator` are in PATH, or set ANDROID_HOME/ANDROID_SDK_ROOT.';
}

import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function tryReadLockPid(lockPath: string): Promise<number | null> {
    try {
        const raw = await readFile(lockPath, 'utf8');
        const parsed = JSON.parse(raw) as { pid?: unknown };
        return typeof parsed.pid === 'number' ? parsed.pid : null;
    } catch {
        return null;
    }
}

export async function acquireRunnerProcessLock(input: {
    lockPath: string;
    controlPlaneBaseUrl: string;
    runnerLabel: string;
}): Promise<() => Promise<void>> {
    const { lockPath, controlPlaneBaseUrl, runnerLabel } = input;

    await mkdir(path.dirname(lockPath), { recursive: true });

    const writeLock = async () => {
        const handle = await open(lockPath, 'wx');
        try {
            await handle.writeFile(JSON.stringify({
                pid: process.pid,
                startedAt: new Date().toISOString(),
                controlPlaneBaseUrl,
                runnerLabel,
            }));
        } finally {
            await handle.close();
        }
    };

    try {
        await writeLock();
    } catch {
        const lockPid = await tryReadLockPid(lockPath);
        if (!lockPid || !isProcessAlive(lockPid)) {
            await rm(lockPath, { force: true });
            await writeLock();
        } else {
            throw new Error(`Another macOS runner process is already running (pid ${lockPid})`);
        }
    }

    return async () => {
        await rm(lockPath, { force: true });
    };
}

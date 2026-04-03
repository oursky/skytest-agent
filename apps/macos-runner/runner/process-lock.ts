import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
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

async function moveStaleLockAside(lockPath: string): Promise<boolean> {
    const stalePath = `${lockPath}.stale.${process.pid}.${Date.now()}`;
    try {
        await rename(lockPath, stalePath);
    } catch {
        return false;
    }

    try {
        await rm(stalePath, { force: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to delete stale lock file ${stalePath}: ${message}`);
    }
    return true;
}

async function cleanupLeakedStaleLocks(lockPath: string): Promise<void> {
    const lockDir = path.dirname(lockPath);
    const lockName = path.basename(lockPath);
    const stalePrefix = `${lockName}.stale.`;

    try {
        const entries = await readdir(lockDir);
        await Promise.all(entries
            .filter((entry) => entry.startsWith(stalePrefix))
            .map(async (entry) => {
                try {
                    await rm(path.join(lockDir, entry), { force: true });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`Failed to delete leaked stale lock ${entry}: ${message}`);
                }
            }));
    } catch {
    }
}

export async function acquireRunnerProcessLock(input: {
    lockPath: string;
    controlPlaneBaseUrl: string;
    runnerLabel: string;
}): Promise<() => Promise<void>> {
    const { lockPath, controlPlaneBaseUrl, runnerLabel } = input;

    await mkdir(path.dirname(lockPath), { recursive: true });
    await cleanupLeakedStaleLocks(lockPath);

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
            const staleLockMoved = await moveStaleLockAside(lockPath);
            if (!staleLockMoved) {
                await writeLock();
            } else {
                try {
                    await writeLock();
                } catch {
                    const competingPid = await tryReadLockPid(lockPath);
                    if (competingPid && isProcessAlive(competingPid)) {
                        throw new Error(`Another macOS runner process is already running (pid ${competingPid})`);
                    }
                    throw new Error('Failed to acquire runner process lock after recovering stale lock');
                }
            }
        } else {
            throw new Error(`Another macOS runner process is already running (pid ${lockPid})`);
        }
    }

    return async () => {
        await rm(lockPath, { force: true });
    };
}

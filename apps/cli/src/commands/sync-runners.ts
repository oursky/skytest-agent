import { syncRunners } from '../runtime/runner-manager';
import { type OutputFormat, printTable, printValue } from './output';

interface SyncRunnersOptions {
    format: OutputFormat;
}

export async function runSyncRunnersCommand(options: SyncRunnersOptions): Promise<void> {
    const synced = await syncRunners();
    if (options.format === 'json') {
        const payload = {
            command: 'sync runners',
            removedLocalRunnerIds: synced.removedLocalRunnerIds,
            runners: synced.runners.map((runner) => ({
                localRunnerId: runner.metadata.localRunnerId,
                serverRunnerId: runner.metadata.serverRunnerId,
                label: runner.metadata.label,
                status: runner.status,
                pid: runner.pid,
                controlPlaneBaseUrl: runner.metadata.controlPlaneBaseUrl,
                credentialExpiresAt: runner.credential.credentialExpiresAt,
                logPath: runner.logPath,
                updatedAt: runner.metadata.updatedAt,
            })),
        };
        printValue(payload, options.format);
        return;
    }

    if (synced.removedLocalRunnerIds.length > 0) {
        printValue(
            `Removed stale local runners: ${synced.removedLocalRunnerIds.join(', ')}`,
            options.format
        );
    }

    if (synced.runners.length === 0) {
        printValue('No runners paired.', options.format);
        return;
    }

    const rows = synced.runners.map((runner) => [
        runner.metadata.localRunnerId,
        runner.metadata.label,
        runner.status,
        runner.pid ? String(runner.pid) : '-',
        runner.metadata.controlPlaneBaseUrl,
    ]);

    printTable(['ID', 'LABEL', 'STATUS', 'PID', 'CONTROL PLANE'], rows);
}

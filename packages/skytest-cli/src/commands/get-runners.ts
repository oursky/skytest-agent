import { getRunners } from '../runtime/runner-manager';
import { type OutputFormat, printTable, printValue } from './output';

interface GetRunnersOptions {
    format: OutputFormat;
}

export async function runGetRunnersCommand(options: GetRunnersOptions): Promise<void> {
    const runners = await getRunners();
    if (options.format === 'json') {
        const payload = runners.map((runner) => ({
            localRunnerId: runner.metadata.localRunnerId,
            serverRunnerId: runner.metadata.serverRunnerId,
            label: runner.metadata.label,
            status: runner.status,
            pid: runner.pid,
            controlPlaneBaseUrl: runner.metadata.controlPlaneBaseUrl,
            credentialExpiresAt: runner.credential.credentialExpiresAt,
            logPath: runner.logPath,
            updatedAt: runner.metadata.updatedAt,
        }));
        printValue(payload, options.format);
        return;
    }

    if (runners.length === 0) {
        printValue('No runners paired.', options.format);
        return;
    }

    const rows = runners.map((runner) => [
        runner.metadata.localRunnerId,
        runner.metadata.label,
        runner.status,
        runner.pid ? String(runner.pid) : '-',
        runner.metadata.controlPlaneBaseUrl,
    ]);

    printTable(['ID', 'LABEL', 'STATUS', 'PID', 'CONTROL PLANE'], rows);
}

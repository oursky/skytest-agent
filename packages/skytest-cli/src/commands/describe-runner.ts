import { describeRunner } from '../runtime/runner-manager';
import { type OutputFormat, printValue } from './output';

interface DescribeRunnerOptions {
    runnerId: string;
    format: OutputFormat;
}

export async function runDescribeRunnerCommand(options: DescribeRunnerOptions): Promise<void> {
    const described = await describeRunner(options.runnerId);
    const payload = {
        localRunnerId: described.metadata.localRunnerId,
        serverRunnerId: described.metadata.serverRunnerId,
        label: described.metadata.label,
        status: described.status,
        pid: described.pid,
        controlPlaneBaseUrl: described.metadata.controlPlaneBaseUrl,
        credentialExpiresAt: described.credential.credentialExpiresAt,
        runnerToken: described.maskedRunnerToken,
        logPath: described.logPath,
        createdAt: described.metadata.createdAt,
        updatedAt: described.metadata.updatedAt,
        lastStartedAt: described.metadata.lastStartedAt ?? null,
        lastStoppedAt: described.metadata.lastStoppedAt ?? null,
    };
    printValue(payload, options.format);
}

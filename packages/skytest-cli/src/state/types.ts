import type { RunnerTransportMetadata } from '@skytest/runner-protocol';

export interface LocalRunnerMetadata {
    localRunnerId: string;
    serverRunnerId: string;
    label: string;
    controlPlaneBaseUrl: string;
    createdAt: string;
    updatedAt: string;
    lastStartedAt?: string;
    lastStoppedAt?: string;
}

export interface LocalRunnerCredential {
    runnerToken: string;
    runnerId: string;
    credentialExpiresAt: string;
    transport: RunnerTransportMetadata;
    updatedAt: string;
}

export interface LocalRunnerDescriptor {
    metadata: LocalRunnerMetadata;
    credential: LocalRunnerCredential;
    pid: number | null;
    status: 'RUNNING' | 'STOPPED';
    logPath: string;
}

export interface LocalRunnerPaths {
    runnerDir: string;
    metadataPath: string;
    credentialPath: string;
    pidPath: string;
    logPath: string;
    runtimeStateDir: string;
}

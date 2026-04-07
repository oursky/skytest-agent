export type RuntimeInstanceType = 'root' | 'worktree';

export interface SkytestRuntimeInstanceIdentity {
    schemaVersion: 1;
    instanceId: string;
    instanceType: RuntimeInstanceType;
    instanceName: string;
    generatedAt: string;
}

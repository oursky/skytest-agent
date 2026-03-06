export type ExecutionCapability = 'BROWSER' | 'ANDROID';

export interface ExecutionTarget {
    id: string;
    capability: ExecutionCapability;
}

export interface ExecutionRunRequest {
    runId: string;
    target: ExecutionTarget;
}

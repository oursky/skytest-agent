import crypto from 'node:crypto';

export function buildRunnerDisplayId(seed: string): string {
    return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 6);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

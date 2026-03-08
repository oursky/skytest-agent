import { randomBytes } from 'node:crypto';

const LOCAL_RUNNER_ID_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LOCAL_RUNNER_ID_LENGTH = 6;
const MAX_ID_ATTEMPTS = 200;

function generateCandidateId(): string {
    const bytes = randomBytes(LOCAL_RUNNER_ID_LENGTH);
    let candidate = '';

    for (let index = 0; index < LOCAL_RUNNER_ID_LENGTH; index += 1) {
        candidate += LOCAL_RUNNER_ID_CHARSET[bytes[index] % LOCAL_RUNNER_ID_CHARSET.length];
    }

    return candidate;
}

export function generateLocalRunnerId(existingRunnerIds: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
        const candidate = generateCandidateId();
        if (!existingRunnerIds.has(candidate)) {
            return candidate;
        }
    }

    throw new Error('Failed to allocate a unique local runner ID after multiple attempts.');
}

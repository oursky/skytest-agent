interface ResolveSnapshotTestCaseIdentityInput {
    displayId?: string | null;
    name?: string | null;
    fallbackDisplayId?: string;
    fallbackName?: string;
}

interface SnapshotTestCaseIdentity {
    displayId?: string;
    name?: string;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
    for (const value of values) {
        if (typeof value !== 'string') {
            continue;
        }

        const trimmed = value.trim();
        if (trimmed.length > 0) {
            return trimmed;
        }
    }

    return undefined;
}

export function resolveSnapshotTestCaseIdentity(
    input: ResolveSnapshotTestCaseIdentityInput
): SnapshotTestCaseIdentity {
    return {
        displayId: firstNonEmpty(input.displayId, input.fallbackDisplayId),
        name: firstNonEmpty(input.name, input.fallbackName),
    };
}

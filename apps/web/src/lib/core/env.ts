export function parseBoundedIntEnv(input: {
    name: string;
    fallback: number;
    min: number;
    max: number;
}): number {
    const value = Number.parseInt(process.env[input.name] ?? '', 10);
    if (!Number.isFinite(value)) {
        return input.fallback;
    }

    return Math.min(input.max, Math.max(input.min, value));
}

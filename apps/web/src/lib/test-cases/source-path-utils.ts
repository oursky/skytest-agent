import path from 'node:path';

export function resolveRuntimeRootFromSourcePath(sourcePath: string | null | undefined): string | null {
    if (!sourcePath) {
        return null;
    }

    const normalizedPath = path.normalize(sourcePath);
    const marker = `${path.sep}.skytest${path.sep}`;
    const markerIndex = normalizedPath.indexOf(marker);
    if (markerIndex < 0) {
        return null;
    }

    return normalizedPath.slice(0, markerIndex);
}

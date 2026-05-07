import path from 'node:path';

export function isCatalogSourcePath(sourcePath: string | null | undefined): sourcePath is string {
    if (!sourcePath) {
        return false;
    }

    const normalizedPath = path.normalize(sourcePath);
    const marker = `${path.sep}.skytest${path.sep}`;
    return path.isAbsolute(normalizedPath) && normalizedPath.includes(marker);
}

export function resolveRuntimeRootFromSourcePath(sourcePath: string | null | undefined): string | null {
    if (!isCatalogSourcePath(sourcePath)) {
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

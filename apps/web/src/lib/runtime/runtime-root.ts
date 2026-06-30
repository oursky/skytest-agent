import path from 'node:path';

// Base directory that holds SkyTest's mutable runtime state (the `.skytest`
// directory with the instance-identity lockfile and any file-source catalog).
// Defaults to the process working directory, which is correct for local and
// CLI use; hosted deployments point it at a writable data directory via
// SKYTEST_RUNTIME_ROOT so runtime state never lands in the read-only code tree.
//
// Server-only: this reads from the filesystem/process, so it must never be
// imported into client bundles (keep it out of `config/app.ts`).
export function getRuntimeRootDir(): string {
    const configured = process.env.SKYTEST_RUNTIME_ROOT?.trim();
    return configured ? path.resolve(configured) : process.cwd();
}

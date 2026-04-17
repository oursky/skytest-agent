#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const repoRoot = path.resolve(workspaceRoot, '../..');
const rootPkgPath = path.resolve(repoRoot, 'package.json');
const webPkgPath = path.resolve(workspaceRoot, 'package.json');
const allowlistPath = path.resolve(workspaceRoot, 'scripts/quality/overrides-drift-allowlist.json');

function readOverrides(pkgPath) {
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return raw.overrides ?? {};
}

const rootOverrides = readOverrides(rootPkgPath);
const webOverrides = readOverrides(webPkgPath);
const allowlist = JSON.parse(readFileSync(allowlistPath, 'utf8'));

const webOnlyAllowed = new Set(allowlist.webOnly ?? []);
const rootOnlyAllowed = new Set(allowlist.rootOnly ?? []);
const valueDriftAllowed = new Set(allowlist.valueDriftAllowed ?? []);

const rootKeys = new Set(Object.keys(rootOverrides));
const webKeys = new Set(Object.keys(webOverrides));

const errors = [];

for (const key of webKeys) {
    if (!rootKeys.has(key) && !webOnlyAllowed.has(key)) {
        errors.push(
            `- "${key}" present only in apps/web/package.json; add to root overrides or add to webOnly allowlist.`
        );
    }
}

for (const key of rootKeys) {
    if (!webKeys.has(key) && !rootOnlyAllowed.has(key)) {
        errors.push(
            `- "${key}" present only in root package.json; add to apps/web overrides or add to rootOnly allowlist.`
        );
    }
}

for (const key of webKeys) {
    if (!rootKeys.has(key)) continue;
    if (valueDriftAllowed.has(key)) continue;
    const rootValue = JSON.stringify(rootOverrides[key]);
    const webValue = JSON.stringify(webOverrides[key]);
    if (rootValue !== webValue) {
        errors.push(
            `- "${key}" value drift: root=${rootValue} apps/web=${webValue}. Align or add to valueDriftAllowed.`
        );
    }
}

for (const key of webOnlyAllowed) {
    if (!webKeys.has(key)) {
        errors.push(
            `- "${key}" listed in webOnly allowlist but not present in apps/web overrides; remove stale entry.`
        );
    }
}

for (const key of rootOnlyAllowed) {
    if (!rootKeys.has(key)) {
        errors.push(
            `- "${key}" listed in rootOnly allowlist but not present in root overrides; remove stale entry.`
        );
    }
}

for (const key of valueDriftAllowed) {
    if (!rootKeys.has(key) || !webKeys.has(key)) {
        errors.push(
            `- "${key}" listed in valueDriftAllowed but not a shared override; remove stale entry.`
        );
    }
}

if (errors.length > 0) {
    console.error('Overrides drift check failed:');
    for (const line of errors) {
        console.error(line);
    }
    console.error(
        `\nAllowlist: ${path.relative(repoRoot, allowlistPath)}`
    );
    process.exit(1);
}

console.log(
    `Overrides drift check passed: ${rootKeys.size} root keys, ${webKeys.size} apps/web keys, `
    + `${[...webKeys].filter((k) => rootKeys.has(k)).length} shared.`
);

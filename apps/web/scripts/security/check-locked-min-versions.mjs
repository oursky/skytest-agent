#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const repoRoot = path.resolve(workspaceRoot, '../..');
const lockfilePath = path.resolve(repoRoot, 'package-lock.json');

const FLOORS = {
    'js-yaml': '4.1.1',
    '@modelcontextprotocol/sdk': '1.26.0',
    // GHSA-gh4j-gqv2-49f6
    '@aws-sdk/xml-builder': '3.972.19',
    'fast-xml-parser': '5.7.0',
    // GHSA-2v35-w6hq-6mfw, GHSA-f6ww-3ggp-fr8h, GHSA-x6wf-f3px-wcqx, GHSA-j759-j44w-7fr8
    '@xmldom/xmldom': '0.8.13',
    // GHSA-w5hq-g745-h8pq
    'uuid': '14.0.0',
};

function parseSemver(version) {
    if (typeof version !== 'string') {
        return null;
    }
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version);
    if (!match) {
        return null;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ?? null,
    };
}

function compareSemver(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    if (a.patch !== b.patch) return a.patch - b.patch;
    if (a.prerelease === b.prerelease) return 0;
    if (a.prerelease === null) return 1;
    if (b.prerelease === null) return -1;
    return a.prerelease < b.prerelease ? -1 : 1;
}

function extractPackageName(lockPath) {
    const segments = lockPath.split('/');
    for (let i = segments.length - 1; i >= 0; i -= 1) {
        if (segments[i] !== 'node_modules' && segments[i - 1] === 'node_modules') {
            if (segments[i].startsWith('@') && i + 1 < segments.length && segments[i + 1] !== 'node_modules') {
                return `${segments[i]}/${segments[i + 1]}`;
            }
            return segments[i];
        }
    }
    return null;
}

const raw = readFileSync(lockfilePath, 'utf8');
const lock = JSON.parse(raw);
const packages = lock.packages ?? {};

const violations = [];
for (const [lockPath, meta] of Object.entries(packages)) {
    if (!lockPath || !meta || typeof meta !== 'object' || typeof meta.version !== 'string') {
        continue;
    }
    const name = meta.name ?? extractPackageName(lockPath);
    if (!name || !(name in FLOORS)) {
        continue;
    }
    const floor = FLOORS[name];
    const actual = parseSemver(meta.version);
    const required = parseSemver(floor);
    if (!actual || !required) {
        continue;
    }
    if (compareSemver(actual, required) < 0) {
        violations.push({ path: lockPath, name, version: meta.version, floor });
    }
}

if (violations.length > 0) {
    console.error('Lockfile CVE floor check failed: vulnerable versions present in package-lock.json:');
    for (const item of violations) {
        console.error(`- ${item.name} ${item.version} < ${item.floor} at ${item.path}`);
    }
    console.error(
        '\nThese packages have known advisories patched in the floor versions above.'
        + ' Update direct deps, add overrides in package.json, or prune nested transitive copies.'
    );
    process.exit(1);
}

console.log(
    `Lockfile CVE floor check passed: ${Object.keys(FLOORS).length} packages at or above their floor versions.`
);

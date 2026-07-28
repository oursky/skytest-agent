#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const repoRoot = path.resolve(workspaceRoot, '../..');
const lockfilePath = path.resolve(repoRoot, 'package-lock.json');

const FLOORS = {
    // GHSA-52cp-r559-cp3m (merge-key chain quadratic DoS, patched in 4.3.0)
    'js-yaml': '4.3.0',
    // GHSA-frvp-7c67-39w9 (encoded-backslash path traversal in the Hono Node adapter)
    '@modelcontextprotocol/sdk': '1.30.0',
    '@hono/node-server': '2.0.5',
    // GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg
    'brace-expansion': '5.0.8',
    // Axios recursion, prototype-pollution, proxy, and streamed-upload advisory chain
    'axios': '1.18.0',
    // GHSA-v422-hmwv-36x6
    'body-parser': '1.20.6',
    // GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83qw-93j6
    'fast-uri': '3.1.4',
    // GHSA-gh4j-gqv2-49f6
    '@aws-sdk/xml-builder': '3.972.19',
    'fast-xml-parser': '5.7.0',
    // GHSA-2v35-w6hq-6mfw, GHSA-f6ww-3ggp-fr8h, GHSA-x6wf-f3px-wcqx, GHSA-j759-j44w-7fr8
    '@xmldom/xmldom': '0.8.13',
    // GHSA-w5hq-g745-h8pq
    'uuid': '14.0.0',
    // GHSA-xrhx-7g5j-rcj5, GHSA-3hrh-pfw6-9m5x, GHSA-f577-qrjj-4474, GHSA-2gcr-mfcq-wcc3,
    // plus CORS wildcard-credentials (GHSA-88fw-hqm2-52qc) patched in 4.12.25
    'hono': '4.12.25',
    // GHSA-q8mj-m7cp-5q26
    'qs': '6.15.2',
    // GHSA-ph9p-34f9-6g65
    'tmp': '0.2.6',
    // GHSA-5xrq-8626-4rwp
    'vitest': '4.1.0',
    // undici Set-Cookie/header-injection + WebSocket DoS chain, patched in 6.27.0
    'undici': '6.27.0',
    // GHSA-96hv-2xvq-fx4p (memory-exhaustion DoS from tiny fragments/chunks), patched in 8.21.0
    'ws': '8.21.0',
    // DOMPurify hook/custom-element bypass chain, patched in 3.4.12
    'dompurify': '3.4.12',
    // GHSA-hmw2-7cc7-3qxx (form-data multipart CRLF injection), patched in 4.0.6
    'form-data': '4.0.6',
    // GHSA-fx2h-pf6j-xcff (server.fs.deny bypass) + launch-editor UNC disclosure, patched in 7.3.5
    'vite': '7.3.5',
    // GHSA-g7r4-m6w7-qqqr (dev-server arbitrary file read on Windows), patched in 0.28.1
    'esbuild': '0.28.1',
    // Next.js App Router security advisory chain, patched in 16.2.11
    'next': '16.2.11',
    // GHSA-r28c-9q8g-f849
    'postcss': '8.5.18',
    // GHSA-f88m-g3jw-g9cj
    'sharp': '0.35.0',
    // GHSA-395f-4hp3-45gv
    'shell-quote': '1.9.0',
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

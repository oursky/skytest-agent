#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const ignoredAdvisoryUrls = new Set([
    'https://github.com/advisories/GHSA-r5fr-rjxr-66jc',
    'https://github.com/advisories/GHSA-f23m-r3pf-42rh',
    'https://github.com/advisories/GHSA-8r9q-7v3j-jr4g',
    'https://github.com/advisories/GHSA-345p-7cg4-v4c7',
    'https://github.com/advisories/GHSA-w48q-cv73-mx4w',
    'https://github.com/advisories/GHSA-mh29-5h37-fv8m',
    'https://github.com/advisories/GHSA-qx2v-qp2m-jg93',
]);

function runAuditJson() {
    try {
        return execFileSync(
            'npm',
            ['audit', '--audit-level=moderate', '--package-lock-only', '--json'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
    } catch (error) {
        if (!(error instanceof Error)) {
            throw error;
        }

        const stdout = typeof error.stdout === 'string'
            ? error.stdout
            : Buffer.isBuffer(error.stdout)
                ? error.stdout.toString('utf8')
                : '';

        const stderr = typeof error.stderr === 'string'
            ? error.stderr
            : Buffer.isBuffer(error.stderr)
                ? error.stderr.toString('utf8')
                : '';

        if (!stdout.trim()) {
            if (stderr.trim()) {
                console.error(stderr.trim());
            }
            process.exit(1);
        }

        return stdout;
    }
}

function parseAuditReport(rawReport) {
    try {
        return JSON.parse(rawReport);
    } catch {
        console.error('Failed to parse npm audit JSON output.');
        process.exit(1);
    }
}

function collectUnignoredFindings(report) {
    const vulnerabilities = report && typeof report === 'object' && report.vulnerabilities && typeof report.vulnerabilities === 'object'
        ? report.vulnerabilities
        : {};

    const findings = [];
    const seen = new Set();

    for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
        const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];

        for (const issue of via) {
            if (!issue || typeof issue !== 'object') {
                continue;
            }

            const url = typeof issue.url === 'string' ? issue.url : '';
            if (ignoredAdvisoryUrls.has(url)) {
                continue;
            }

            const key = `${packageName}|${url}|${String(issue.title ?? '')}`;
            if (seen.has(key)) {
                continue;
            }

            seen.add(key);
            findings.push({
                packageName,
                severity: String(issue.severity ?? vulnerability?.severity ?? 'unknown'),
                title: String(issue.title ?? 'Unknown advisory'),
                url: url || '(no advisory url)',
            });
        }
    }

    return findings;
}

const rawReport = runAuditJson();
const report = parseAuditReport(rawReport);
const findings = collectUnignoredFindings(report);

if (findings.length > 0) {
    console.error('npm audit failed with non-allowlisted advisories:');
    for (const finding of findings) {
        console.error(`- [${finding.severity}] ${finding.packageName}: ${finding.title} (${finding.url})`);
    }
    process.exit(1);
}

console.log('npm audit passed (only allowlisted upstream advisories found).');

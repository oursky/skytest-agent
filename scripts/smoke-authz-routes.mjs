#!/usr/bin/env node

function parseArgs(argv) {
    const options = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--')) {
            continue;
        }

        const [rawKey, inlineValue] = arg.slice(2).split('=');
        if (!rawKey) {
            continue;
        }

        if (inlineValue !== undefined) {
            options[rawKey] = inlineValue;
            continue;
        }

        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            options[rawKey] = 'true';
            continue;
        }

        options[rawKey] = next;
        index += 1;
    }

    return options;
}

function printHelp() {
    console.log([
        'Usage:',
        '  node scripts/smoke-authz-routes.mjs --base-url <url> --owner-token <token> --attacker-token <token> --project-id <id> --test-case-id <id> --test-run-id <id> [--file-id <id>]',
        '',
        'Example:',
        '  npm run smoke:authz -- --base-url http://localhost:3000 --owner-token <owner> --attacker-token <attacker> --project-id <p> --test-case-id <tc> --test-run-id <tr>',
    ].join('\n'));
}

async function requestJson(baseUrl, path, token, method = 'GET', body) {
    const headers = token
        ? { 'Authorization': `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }
        : (body ? { 'Content-Type': 'application/json' } : {});

    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body ? { body: JSON.stringify(body) } : {}),
    });

    let payloadText = '';
    try {
        payloadText = await response.text();
    } catch {
        payloadText = '';
    }

    return {
        status: response.status,
        body: payloadText.slice(0, 300),
    };
}

function statusAllowed(status, allowed) {
    return allowed.includes(status);
}

function assertStatus(label, result, expected) {
    if (statusAllowed(result.status, expected)) {
        return { ok: true, message: `${label}: status=${result.status}` };
    }
    return {
        ok: false,
        message: `${label}: expected ${expected.join('/')} but got ${result.status} body=${result.body}`,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help === 'true' || args.h === 'true') {
        printHelp();
        return;
    }

    const baseUrl = String(args['base-url'] ?? '').replace(/\/$/, '');
    const ownerToken = String(args['owner-token'] ?? '');
    const attackerToken = String(args['attacker-token'] ?? '');
    const projectId = String(args['project-id'] ?? '');
    const testCaseId = String(args['test-case-id'] ?? '');
    const testRunId = String(args['test-run-id'] ?? '');
    const fileId = args['file-id'] ? String(args['file-id']) : '';

    const missing = [];
    if (!baseUrl) missing.push('--base-url');
    if (!ownerToken) missing.push('--owner-token');
    if (!attackerToken) missing.push('--attacker-token');
    if (!projectId) missing.push('--project-id');
    if (!testCaseId) missing.push('--test-case-id');
    if (!testRunId) missing.push('--test-run-id');

    if (missing.length > 0) {
        console.error(`Missing required flags: ${missing.join(', ')}`);
        printHelp();
        process.exitCode = 1;
        return;
    }

    const checks = [];

    const ownerProject = await requestJson(baseUrl, `/api/projects/${projectId}`, ownerToken);
    checks.push(assertStatus('Owner project GET', ownerProject, [200]));

    const attackerProject = await requestJson(baseUrl, `/api/projects/${projectId}`, attackerToken);
    checks.push(assertStatus('Attacker project GET', attackerProject, [403, 404]));

    const ownerTestCase = await requestJson(baseUrl, `/api/test-cases/${testCaseId}`, ownerToken);
    checks.push(assertStatus('Owner test-case GET', ownerTestCase, [200]));

    const attackerTestCase = await requestJson(baseUrl, `/api/test-cases/${testCaseId}`, attackerToken);
    checks.push(assertStatus('Attacker test-case GET', attackerTestCase, [403, 404]));

    const ownerHistory = await requestJson(baseUrl, `/api/test-cases/${testCaseId}/history?limit=1`, ownerToken);
    checks.push(assertStatus('Owner test-case history GET', ownerHistory, [200]));

    const attackerHistory = await requestJson(baseUrl, `/api/test-cases/${testCaseId}/history?limit=1`, attackerToken);
    checks.push(assertStatus('Attacker test-case history GET', attackerHistory, [403, 404]));

    const ownerRun = await requestJson(baseUrl, `/api/test-runs/${testRunId}`, ownerToken);
    checks.push(assertStatus('Owner test-run GET', ownerRun, [200]));

    const attackerRun = await requestJson(baseUrl, `/api/test-runs/${testRunId}`, attackerToken);
    checks.push(assertStatus('Attacker test-run GET', attackerRun, [403, 404]));

    const ownerProjectToken = await requestJson(baseUrl, '/api/stream-tokens', ownerToken, 'POST', {
        scope: 'project-events',
        resourceId: projectId,
    });
    checks.push(assertStatus('Owner project-events token', ownerProjectToken, [200]));

    const attackerProjectToken = await requestJson(baseUrl, '/api/stream-tokens', attackerToken, 'POST', {
        scope: 'project-events',
        resourceId: projectId,
    });
    checks.push(assertStatus('Attacker project-events token', attackerProjectToken, [403, 404]));

    const ownerRunToken = await requestJson(baseUrl, '/api/stream-tokens', ownerToken, 'POST', {
        scope: 'test-run-events',
        resourceId: testRunId,
    });
    checks.push(assertStatus('Owner test-run-events token', ownerRunToken, [200]));

    const attackerRunToken = await requestJson(baseUrl, '/api/stream-tokens', attackerToken, 'POST', {
        scope: 'test-run-events',
        resourceId: testRunId,
    });
    checks.push(assertStatus('Attacker test-run-events token', attackerRunToken, [403, 404]));

    const ownerFileToken = await requestJson(baseUrl, '/api/stream-tokens', ownerToken, 'POST', {
        scope: 'test-case-files',
        resourceId: testCaseId,
    });
    checks.push(assertStatus('Owner test-case-files token', ownerFileToken, [200]));

    const attackerFileToken = await requestJson(baseUrl, '/api/stream-tokens', attackerToken, 'POST', {
        scope: 'test-case-files',
        resourceId: testCaseId,
    });
    checks.push(assertStatus('Attacker test-case-files token', attackerFileToken, [403, 404]));

    if (fileId) {
        const ownerFile = await requestJson(baseUrl, `/api/test-cases/${testCaseId}/files/${fileId}`, ownerToken);
        checks.push(assertStatus('Owner test-case file GET', ownerFile, [200]));

        const attackerFile = await requestJson(baseUrl, `/api/test-cases/${testCaseId}/files/${fileId}`, attackerToken);
        checks.push(assertStatus('Attacker test-case file GET', attackerFile, [403, 404]));
    }

    const failed = checks.filter((check) => !check.ok);
    const passed = checks.length - failed.length;

    console.log('\nAuthZ Smoke Summary');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed.length}`);

    for (const check of checks) {
        console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.message}`);
    }

    if (failed.length > 0) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});

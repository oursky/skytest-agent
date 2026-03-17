import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const RUNNER_TOKEN = __ENV.RUNNER_TOKEN || '';
const RUNNER_PROTOCOL_VERSION = __ENV.RUNNER_PROTOCOL_VERSION || '0.1.0';
const RUNNER_VERSION = __ENV.RUNNER_VERSION || '0.1.0';
const CLAIM_RPS = Number(__ENV.CLAIM_RPS || 3);
const DURATION = __ENV.CLAIM_DURATION || '45s';

if (!RUNNER_TOKEN) {
    throw new Error('RUNNER_TOKEN is required');
}

export const options = {
    scenarios: {
        runner_claim_flow: {
            executor: 'constant-arrival-rate',
            rate: CLAIM_RPS,
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: 8,
            maxVUs: 24,
        },
    },
    thresholds: {
        'http_req_duration{endpoint:claim}': ['p(95)<400', 'avg<250'],
        'http_req_failed': ['rate<0.01'],
        checks: ['rate>0.99'],
    },
};

const headers = {
    Authorization: `Bearer ${RUNNER_TOKEN}`,
    'Content-Type': 'application/json',
};

function createRunnerPayload(extra = {}) {
    return JSON.stringify({
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        runnerVersion: RUNNER_VERSION,
        ...extra,
    });
}

export default function runClaimFlow() {
    const claimResponse = http.post(
        `${BASE_URL}/api/runners/v1/jobs/claim`,
        createRunnerPayload(),
        { headers, tags: { endpoint: 'claim' } }
    );
    const claimOk = check(claimResponse, {
        'claim status is 200': (res) => res.status === 200,
    });
    if (!claimOk) {
        return;
    }

    const claimBody = claimResponse.json();
    const job = claimBody && claimBody.job ? claimBody.job : null;
    if (!job || !job.runId) {
        sleep(0.1);
        return;
    }

    const completeResponse = http.post(
        `${BASE_URL}/api/runners/v1/jobs/${job.runId}/complete`,
        createRunnerPayload({ result: JSON.stringify({ status: 'PASS' }) }),
        { headers, tags: { endpoint: 'complete' } }
    );
    check(completeResponse, {
        'complete status is 200': (res) => res.status === 200,
    });
}

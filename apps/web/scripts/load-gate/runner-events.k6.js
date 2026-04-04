import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = (__ENV.LOAD_GATE_RUNNER_EVENTS_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const RUN_ID = __ENV.LOAD_GATE_RUNNER_EVENTS_RUN_ID || '';
const RUNNER_TOKEN = __ENV.LOAD_GATE_RUNNER_EVENTS_RUNNER_TOKEN || '';
const PROTOCOL_VERSION = __ENV.LOAD_GATE_RUNNER_EVENTS_PROTOCOL_VERSION || '1.0.0';
const RUNNER_VERSION = __ENV.LOAD_GATE_RUNNER_EVENTS_RUNNER_VERSION || '0.1.0';
const EVENT_BATCH_SIZE = Number(__ENV.LOAD_GATE_RUNNER_EVENTS_BATCH_SIZE || '20');

if (!RUN_ID) {
    throw new Error('LOAD_GATE_RUNNER_EVENTS_RUN_ID is required');
}
if (!RUNNER_TOKEN) {
    throw new Error('LOAD_GATE_RUNNER_EVENTS_RUNNER_TOKEN is required');
}

export const options = {
    scenarios: {
        runner_events_flow: {
            executor: 'ramping-arrival-rate',
            startRate: 2,
            timeUnit: '1s',
            preAllocatedVUs: 10,
            maxVUs: 30,
            stages: [
                { target: 5, duration: '30s' },
                { target: 8, duration: '60s' },
                { target: 0, duration: '20s' },
            ],
        },
    },
    thresholds: {
        checks: ['rate>0.99'],
        'http_req_duration{endpoint:runner-events}': ['p(95)<500', 'avg<300'],
        'http_req_failed{endpoint:runner-events}': ['rate<0.01'],
    },
};

function buildEvents() {
    const now = Date.now();
    const events = [];
    for (let i = 0; i < EVENT_BATCH_SIZE; i += 1) {
        events.push({
            kind: 'LOG',
            message: `k6 runner event ${i}`,
            payload: {
                type: 'log',
                timestamp: now,
                data: {
                    message: `k6 runner event ${i}`,
                    level: 'info',
                },
            },
        });
    }
    return events;
}

export default function runnerEventsScenario() {
    const payload = JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        runnerVersion: RUNNER_VERSION,
        events: buildEvents(),
    });

    const response = http.post(
        `${BASE_URL}/api/runners/v1/jobs/${RUN_ID}/events`,
        payload,
        {
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${RUNNER_TOKEN}`,
            },
            tags: { endpoint: 'runner-events' },
        }
    );

    const ok = check(response, {
        'runner events status is 200': (res) => res.status === 200,
        'runner events accepted count matches batch size': (res) => {
            if (res.status !== 200) {
                return false;
            }
            const body = res.json();
            return body && body.accepted === EVENT_BATCH_SIZE;
        },
    });

    if (!ok) {
        console.error(`Runner events request failed: ${response.status} ${response.body}`);
    }

    sleep(1);
}

import {
    RUNNER_PROTOCOL_CURRENT_VERSION,
    pairingExchangeRequestSchema,
    pairingExchangeResponseSchema,
    shutdownRunnerRequestSchema,
    shutdownRunnerResponseSchema,
    verifyRunnerCredentialRequestSchema,
    verifyRunnerCredentialResponseSchema,
    type PairingExchangeResponse,
    type VerifyRunnerCredentialResponse,
} from '@skytest/runner-protocol';

interface ExchangePairingTokenOptions {
    pairingToken: string;
    controlPlaneBaseUrl: string;
    hostFingerprint: string;
    displayId: string;
    label: string;
    runnerVersion: string;
}

interface NotifyRunnerShutdownOptions {
    controlPlaneBaseUrl: string;
    runnerToken: string;
    runnerVersion: string;
    reason?: string;
}

interface VerifyRunnerCredentialOptions {
    controlPlaneBaseUrl: string;
    runnerToken: string;
    runnerVersion: string;
}

const SHUTDOWN_NOTIFY_TIMEOUT_MS = 3_000;

function normalizeBaseUrl(input: string): string {
    return input.endsWith('/') ? input.slice(0, -1) : input;
}

export class ControlPlaneHttpError extends Error {
    status: number;
    body: string;

    constructor(message: string, status: number, body: string) {
        super(`${message} with ${status}: ${body}`);
        this.status = status;
        this.body = body;
    }
}

export async function exchangePairingToken(
    options: ExchangePairingTokenOptions
): Promise<PairingExchangeResponse> {
    const payload = pairingExchangeRequestSchema.parse({
        pairingToken: options.pairingToken,
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion: options.runnerVersion,
        hostFingerprint: options.hostFingerprint,
        displayId: options.displayId,
        label: options.label,
        kind: 'MACOS_AGENT',
        capabilities: ['ANDROID'],
    });

    const response = await fetch(`${normalizeBaseUrl(options.controlPlaneBaseUrl)}/api/runners/v1/pairing/exchange`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const responseBody = await response.text();
        throw new ControlPlaneHttpError('Pairing exchange failed', response.status, responseBody);
    }

    const responseJson = await response.json();
    return pairingExchangeResponseSchema.parse(responseJson);
}

export async function notifyRunnerShutdown(
    options: NotifyRunnerShutdownOptions
): Promise<void> {
    const payload = shutdownRunnerRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion: options.runnerVersion,
        reason: options.reason,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, SHUTDOWN_NOTIFY_TIMEOUT_MS);

    try {
        const response = await fetch(`${normalizeBaseUrl(options.controlPlaneBaseUrl)}/api/runners/v1/shutdown`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${options.runnerToken}`,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!response.ok) {
            const responseBody = await response.text();
            throw new ControlPlaneHttpError('Runner shutdown notify failed', response.status, responseBody);
        }

        const responseJson = await response.json();
        shutdownRunnerResponseSchema.parse(responseJson);
    } finally {
        clearTimeout(timeout);
    }
}

export async function verifyRunnerCredential(
    options: VerifyRunnerCredentialOptions
): Promise<VerifyRunnerCredentialResponse> {
    const payload = verifyRunnerCredentialRequestSchema.parse({
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion: options.runnerVersion,
    });

    const response = await fetch(`${normalizeBaseUrl(options.controlPlaneBaseUrl)}/api/runners/v1/credential/verify`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.runnerToken}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const responseBody = await response.text();
        throw new ControlPlaneHttpError('Runner credential verify failed', response.status, responseBody);
    }

    const responseJson = await response.json();
    return verifyRunnerCredentialResponseSchema.parse(responseJson);
}

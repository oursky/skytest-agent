import {
    RUNNER_PROTOCOL_CURRENT_VERSION,
    pairingExchangeRequestSchema,
    pairingExchangeResponseSchema,
    type PairingExchangeResponse,
} from '@skytest/runner-protocol';

interface ExchangePairingTokenOptions {
    pairingToken: string;
    controlPlaneBaseUrl: string;
    label: string;
    runnerVersion: string;
}

function normalizeBaseUrl(input: string): string {
    return input.endsWith('/') ? input.slice(0, -1) : input;
}

export async function exchangePairingToken(
    options: ExchangePairingTokenOptions
): Promise<PairingExchangeResponse> {
    const payload = pairingExchangeRequestSchema.parse({
        pairingToken: options.pairingToken,
        protocolVersion: RUNNER_PROTOCOL_CURRENT_VERSION,
        runnerVersion: options.runnerVersion,
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
        throw new Error(`Pairing exchange failed with ${response.status}: ${responseBody}`);
    }

    const responseJson = await response.json();
    return pairingExchangeResponseSchema.parse(responseJson);
}

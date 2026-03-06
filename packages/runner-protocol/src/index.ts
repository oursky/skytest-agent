import { z } from 'zod';

export const RUNNER_PROTOCOL_CURRENT_VERSION = '1.0.0';
export const RUNNER_PROTOCOL_MINIMUM_VERSION = '1.0.0';
export const RUNNER_MINIMUM_VERSION = '0.1.0';

export const runnerKindSchema = z.enum(['MACOS_AGENT', 'HOSTED_BROWSER']);
export const runnerCapabilitySchema = z.enum(['BROWSER', 'ANDROID']);
export const runnerDevicePlatformSchema = z.enum(['ANDROID']);
export const runnerDeviceStateSchema = z.enum(['ONLINE', 'OFFLINE', 'UNAVAILABLE']);

export const runnerProtocolVersionSchema = z.string().trim().min(1).max(40);
export const runnerVersionSchema = z.string().trim().min(1).max(40);
export const runnerLabelSchema = z.string().trim().min(1).max(120);
export const runnerCapabilitiesSchema = z.array(runnerCapabilitySchema).max(8).default([]);

export const compatibilityMetadataSchema = z.object({
    currentProtocolVersion: z.string().min(1),
    minimumSupportedProtocolVersion: z.string().min(1),
    minimumSupportedRunnerVersion: z.string().min(1),
    upgradeRequired: z.boolean(),
});

export const runnerTransportMetadataSchema = z.object({
    heartbeatIntervalSeconds: z.number().int().positive(),
    claimLongPollTimeoutSeconds: z.number().int().positive(),
    deviceSyncIntervalSeconds: z.number().int().positive(),
});

export const registerRunnerRequestSchema = z.object({
    protocolVersion: runnerProtocolVersionSchema,
    runnerVersion: runnerVersionSchema,
    label: runnerLabelSchema,
    kind: runnerKindSchema,
    capabilities: runnerCapabilitiesSchema,
});

export const registerRunnerResponseSchema = z.object({
    runnerId: z.string().min(1),
    compatibility: compatibilityMetadataSchema,
    transport: runnerTransportMetadataSchema,
    credentialExpiresAt: z.string().datetime(),
    rotationRequired: z.boolean(),
});

export const heartbeatRunnerRequestSchema = z.object({
    protocolVersion: runnerProtocolVersionSchema,
    runnerVersion: runnerVersionSchema,
});

export const heartbeatRunnerResponseSchema = z.object({
    runnerId: z.string().min(1),
    compatibility: compatibilityMetadataSchema,
    transport: runnerTransportMetadataSchema,
    credentialExpiresAt: z.string().datetime(),
    rotationRequired: z.boolean(),
});

export const createPairingTokenResponseSchema = z.object({
    token: z.string().min(1),
    expiresAt: z.string().datetime(),
    compatibility: compatibilityMetadataSchema,
    transport: runnerTransportMetadataSchema,
});

export const pairingExchangeRequestSchema = z.object({
    pairingToken: z.string().trim().min(1),
    protocolVersion: runnerProtocolVersionSchema,
    runnerVersion: runnerVersionSchema,
    label: runnerLabelSchema,
    kind: runnerKindSchema,
    capabilities: runnerCapabilitiesSchema,
});

export const pairingExchangeResponseSchema = z.object({
    runnerId: z.string().min(1),
    runnerToken: z.string().min(1),
    credentialExpiresAt: z.string().datetime(),
    compatibility: compatibilityMetadataSchema,
    transport: runnerTransportMetadataSchema,
    rotationRequired: z.boolean(),
});

export const deviceSyncItemSchema = z.object({
    deviceId: z.string().trim().min(1).max(120),
    platform: runnerDevicePlatformSchema,
    name: z.string().trim().min(1).max(200),
    state: runnerDeviceStateSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export const deviceSyncRequestSchema = z.object({
    protocolVersion: runnerProtocolVersionSchema,
    runnerVersion: runnerVersionSchema,
    devices: z.array(deviceSyncItemSchema).max(100),
});

export const deviceSyncResponseSchema = z.object({
    runnerId: z.string().min(1),
    syncedAt: z.string().datetime(),
    deviceCount: z.number().int().min(0),
    compatibility: compatibilityMetadataSchema,
    rotationRequired: z.boolean(),
});

export type RunnerKind = z.infer<typeof runnerKindSchema>;
export type RunnerCapability = z.infer<typeof runnerCapabilitySchema>;
export type RegisterRunnerRequest = z.infer<typeof registerRunnerRequestSchema>;
export type RegisterRunnerResponse = z.infer<typeof registerRunnerResponseSchema>;
export type HeartbeatRunnerRequest = z.infer<typeof heartbeatRunnerRequestSchema>;
export type HeartbeatRunnerResponse = z.infer<typeof heartbeatRunnerResponseSchema>;
export type CreatePairingTokenResponse = z.infer<typeof createPairingTokenResponseSchema>;
export type PairingExchangeRequest = z.infer<typeof pairingExchangeRequestSchema>;
export type PairingExchangeResponse = z.infer<typeof pairingExchangeResponseSchema>;
export type DeviceSyncItem = z.infer<typeof deviceSyncItemSchema>;
export type DeviceSyncRequest = z.infer<typeof deviceSyncRequestSchema>;
export type DeviceSyncResponse = z.infer<typeof deviceSyncResponseSchema>;
export type CompatibilityMetadata = z.infer<typeof compatibilityMetadataSchema>;
export type RunnerTransportMetadata = z.infer<typeof runnerTransportMetadataSchema>;

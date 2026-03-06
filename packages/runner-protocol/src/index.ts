import { z } from 'zod';

export const RUNNER_PROTOCOL_V1 = '1.0.0';

export const runnerProtocolVersionSchema = z.string().min(1);
export const runnerVersionSchema = z.string().min(1);
export const runnerLabelSchema = z.string().trim().min(1).max(120);
export const runnerCapabilitiesSchema = z.array(z.string().trim().min(1)).default([]);

export const registerRunnerRequestSchema = z.object({
    protocolVersion: runnerProtocolVersionSchema,
    runnerVersion: runnerVersionSchema,
    label: runnerLabelSchema,
    capabilities: runnerCapabilitiesSchema,
});

export const heartbeatRunnerRequestSchema = z.object({
    protocolVersion: runnerProtocolVersionSchema,
    runnerVersion: runnerVersionSchema,
});

export const compatibilityMetadataSchema = z.object({
    currentProtocolVersion: z.string().min(1),
    minimumSupportedProtocolVersion: z.string().min(1),
    minimumSupportedRunnerVersion: z.string().min(1),
    upgradeRequired: z.boolean(),
});

export type RegisterRunnerRequest = z.infer<typeof registerRunnerRequestSchema>;
export type HeartbeatRunnerRequest = z.infer<typeof heartbeatRunnerRequestSchema>;
export type CompatibilityMetadata = z.infer<typeof compatibilityMetadataSchema>;

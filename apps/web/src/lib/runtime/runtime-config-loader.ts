import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import type { SkytestRuntimeConfigFile } from '@/types';

const skytestRuntimeConfigSchema = z.object({
    schemaVersion: z.literal(1),
    runtime: z.object({
        baseUrl: z.url(),
        browser: z.object({
            headless: z.boolean(),
            timeoutMs: z.number().int().positive(),
        }),
        timeouts: z.object({
            stepMs: z.number().int().positive(),
            runMs: z.number().int().positive(),
        }),
        env: z.record(z.string(), z.string()).optional(),
        headers: z.record(z.string(), z.string()).optional(),
    }),
    catalog: z.object({
        include: z.array(z.string()).min(1),
        exclude: z.array(z.string()).optional(),
    }).optional(),
});

export async function loadRuntimeConfigForCwd(cwd: string): Promise<SkytestRuntimeConfigFile> {
    const configPath = path.join(cwd, '.skytest', 'skytest.yaml');
    const raw = await readFile(configPath, 'utf8').catch(() => {
        throw new Error(`Missing runtime config: ${configPath}`);
    });

    const parsedYaml = parseYaml(raw);
    const parsedConfig = skytestRuntimeConfigSchema.safeParse(parsedYaml);
    if (!parsedConfig.success) {
        throw new Error(`Invalid runtime config at ${configPath}: ${parsedConfig.error.issues[0]?.message ?? 'unknown error'}`);
    }

    return parsedConfig.data;
}

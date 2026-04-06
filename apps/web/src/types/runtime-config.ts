export interface SkytestRuntimeConfigFile {
    schemaVersion: 1;
    runtime: {
        baseUrl: string;
        browser: {
            headless: boolean;
            timeoutMs: number;
        };
        timeouts: {
            stepMs: number;
            runMs: number;
        };
        env?: Record<string, string>;
        headers?: Record<string, string>;
    };
    catalog?: {
        include: string[];
        exclude?: string[];
    };
}

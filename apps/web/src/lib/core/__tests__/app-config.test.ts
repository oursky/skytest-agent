import { afterEach, describe, expect, it, vi } from 'vitest';

const originalRunnerMaxConcurrentRuns = process.env.RUNNER_MAX_CONCURRENT_RUNS;
const originalRunnerMaxLocalBrowserRuns = process.env.RUNNER_MAX_LOCAL_BROWSER_RUNS;
const originalProjectMaxConcurrentRunsMax = process.env.PROJECT_MAX_CONCURRENT_RUNS_MAX;

async function loadRunnerConfig() {
    vi.resetModules();
    const { config } = await import('@/config/app');
    return config.runner;
}

describe('app config runner concurrency defaults', () => {
    afterEach(() => {
        if (originalRunnerMaxConcurrentRuns === undefined) {
            delete process.env.RUNNER_MAX_CONCURRENT_RUNS;
        } else {
            process.env.RUNNER_MAX_CONCURRENT_RUNS = originalRunnerMaxConcurrentRuns;
        }

        if (originalRunnerMaxLocalBrowserRuns === undefined) {
            delete process.env.RUNNER_MAX_LOCAL_BROWSER_RUNS;
        } else {
            process.env.RUNNER_MAX_LOCAL_BROWSER_RUNS = originalRunnerMaxLocalBrowserRuns;
        }

        if (originalProjectMaxConcurrentRunsMax === undefined) {
            delete process.env.PROJECT_MAX_CONCURRENT_RUNS_MAX;
        } else {
            process.env.PROJECT_MAX_CONCURRENT_RUNS_MAX = originalProjectMaxConcurrentRunsMax;
        }

        vi.resetModules();
    });

    it('defaults local browser concurrency to global runner concurrency', async () => {
        process.env.RUNNER_MAX_CONCURRENT_RUNS = '6';
        delete process.env.RUNNER_MAX_LOCAL_BROWSER_RUNS;

        const runnerConfig = await loadRunnerConfig();

        expect(runnerConfig.maxConcurrentRuns).toBe(6);
        expect(runnerConfig.maxLocalBrowserRuns).toBe(6);
    });

    it('keeps explicit local browser concurrency override', async () => {
        process.env.RUNNER_MAX_CONCURRENT_RUNS = '6';
        process.env.RUNNER_MAX_LOCAL_BROWSER_RUNS = '2';

        const runnerConfig = await loadRunnerConfig();

        expect(runnerConfig.maxConcurrentRuns).toBe(6);
        expect(runnerConfig.maxLocalBrowserRuns).toBe(2);
    });

    it('derives project max concurrency limit from half of system max', async () => {
        process.env.RUNNER_MAX_CONCURRENT_RUNS = '7';
        process.env.PROJECT_MAX_CONCURRENT_RUNS_MAX = '50';

        const runnerConfig = await loadRunnerConfig();

        expect(runnerConfig.maxConcurrentRuns).toBe(7);
        expect(runnerConfig.maxProjectConcurrentRuns).toBe(3);
    });
});

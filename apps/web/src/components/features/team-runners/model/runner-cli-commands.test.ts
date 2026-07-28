import { describe, expect, it } from 'vitest';
import {
    RUNNER_CLI_COMMANDS,
    buildPairCommand,
    buildStartRunnerCommand,
} from './runner-cli-commands';

describe('runner CLI commands', () => {
    it('uses the released skytest-runner binary for troubleshooting commands', () => {
        expect(Object.values(RUNNER_CLI_COMMANDS)).toEqual([
            'skytest-runner get runners',
            'skytest-runner sync runners',
            "skytest-runner start runner '<runner-id>'",
            "skytest-runner stop runner '<runner-id>'",
            "skytest-runner logs runner '<runner-id>' --tail 200",
            "skytest-runner unpair runner '<runner-id>'",
        ]);
    });

    it('builds a pair command for the current server', () => {
        expect(buildPairCommand('pair-token', 'https://app.skytest.test')).toBe(
            'skytest-runner pair runner "pair-token" --url "https://app.skytest.test"'
        );
    });

    it('escapes runner display IDs in start commands', () => {
        expect(buildStartRunnerCommand("runner'01")).toBe(
            "skytest-runner start runner 'runner'\\''01'"
        );
    });
});

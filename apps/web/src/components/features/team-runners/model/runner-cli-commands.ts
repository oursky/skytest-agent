export const RUNNER_CLI_COMMANDS = {
    getRunners: 'skytest-runner get runners',
    syncRunners: 'skytest-runner sync runners',
    startRunner: "skytest-runner start runner '<runner-id>'",
    stopRunner: "skytest-runner stop runner '<runner-id>'",
    logsRunner: "skytest-runner logs runner '<runner-id>' --tail 200",
    unpairRunner: "skytest-runner unpair runner '<runner-id>'",
} as const;

export function buildPairCommand(token: string | null, serverUrl: string): string {
    const tokenPart = token ?? '<pairing-token>';
    return `skytest-runner pair runner "${tokenPart}" --url "${serverUrl}"`;
}

export function buildStartRunnerCommand(runnerDisplayId: string): string {
    const escaped = runnerDisplayId.replace(/'/g, '\'\\\'\'');
    return `skytest-runner start runner '${escaped}'`;
}

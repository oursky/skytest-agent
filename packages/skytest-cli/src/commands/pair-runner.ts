import { printValue } from './output';

interface PairRunnerOptions {
    pairingToken: string;
}

export async function runPairRunnerCommand(options: PairRunnerOptions): Promise<void> {
    printValue(
        {
            command: 'pair runner',
            status: 'planned',
            pairingTokenPreview: `${options.pairingToken.slice(0, 4)}...`,
            message: 'Pairing implementation is in progress.',
        },
        'text'
    );
}

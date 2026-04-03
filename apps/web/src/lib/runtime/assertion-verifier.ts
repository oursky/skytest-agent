import { AndroidAgent } from '@/types';
import { runAndroidAgentOperation } from '@/lib/runtime/android-runtime-helpers';
import { PlaywrightAgent } from '@midscene/web/playwright';

export type RuntimeLogger = (
    message: string,
    level?: 'info' | 'error' | 'success',
    browserId?: string
) => void;

export interface VerifyQuotedStringsOptions {
    agent: PlaywrightAgent | AndroidAgent;
    expectedStrings: string[];
    log: RuntimeLogger;
    targetLabel: string;
    browserId?: string;
    isAndroidAgent?: boolean;
    androidSignal?: AbortSignal;
}

export async function verifyQuotedStringsExist(
    options: VerifyQuotedStringsOptions
): Promise<void> {
    const {
        agent,
        expectedStrings,
        log,
        targetLabel,
        browserId,
        isAndroidAgent,
        androidSignal,
    } = options;

    for (const expected of expectedStrings) {
        const queryPrompt = `Does the exact text "${expected}" appear on the current page? Respond with ONLY "YES" or "NO".`;

        log(`[${targetLabel}] Checking for exact text: "${expected}"`, 'info', browserId);

        const result = isAndroidAgent
            ? await runAndroidAgentOperation(
                () => agent.aiQuery(queryPrompt),
                'query operation',
                androidSignal
            )
            : await agent.aiQuery(queryPrompt);
        const actualText = String(result).trim().toUpperCase();

        if (actualText === 'NO') {
            throw new Error(
                `Expected to find exact text "${expected}" on the page, but it was not found.`
            );
        }

        if (actualText !== 'YES') {
            throw new Error(
                `Could not confidently verify text "${expected}" due to an unclear page analysis result.`
            );
        }

        log(`[${targetLabel}] Exact match confirmed: "${expected}"`, 'success', browserId);
    }
}

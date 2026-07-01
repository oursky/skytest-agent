import type { AndroidTargetConfig, BrowserConfig, ConfigItem, ConfigType, TestCaseFile, TestStep } from '@/types';
import { normalizeBrowserConfig } from '@/lib/test-config/browser-target';
import { normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { getAndroidDeviceSelectorLabel } from '@/components/features/test-configurations/model/device-utils';
import { TYPE_ORDER } from '@/components/features/test-configurations/model/config-helpers';
import { compareConfigsByName } from '@/lib/test-config/sort';
import type { BrowserEntry } from '@/components/features/test-configurations/model/types';

interface BuildInstructionsMarkdownParams {
    isLoginFlow: boolean;
    name: string;
    displayId?: string;
    browsers: BrowserEntry[];
    steps: TestStep[];
    projectConfigs: ConfigItem[];
    testCaseConfigs: ConfigItem[];
    testCaseFiles?: TestCaseFile[];
    resolveLoginFlowLabel?: (loginFlowId: string) => string;
}

function targetLabel(browser: BrowserEntry, index: number): string {
    if (browser.config.name) {
        return browser.config.name;
    }
    const letter = String.fromCharCode('A'.charCodeAt(0) + index);
    const isAndroid = 'type' in browser.config && browser.config.type === 'android';
    return isAndroid ? `Android ${letter}` : `Browser ${letter}`;
}

const CONFIG_TYPE_HEADINGS: Record<ConfigType, string> = {
    URL: 'URLs',
    APP_ID: 'App IDs',
    VARIABLE: 'Variables',
    FILE: 'Files',
    RANDOM_STRING: 'Random Strings',
};

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

function configDisplayValue(config: ConfigItem): string {
    if (config.type === 'FILE') {
        return config.filename || config.value;
    }
    return config.value;
}

function appendConfigGroup(
    lines: string[],
    heading: string,
    configs: ConfigItem[],
    overriddenNames?: Set<string>,
): void {
    if (configs.length === 0) {
        lines.push(`### ${heading}`);
        lines.push('_None_');
        lines.push('');
        return;
    }
    lines.push(`### ${heading}`);
    const groups = TYPE_ORDER
        .map((type) => ({
            type,
            items: configs.filter((config) => config.type === type).sort(compareConfigsByName),
        }))
        .filter((group) => group.items.length > 0);
    for (const group of groups) {
        lines.push(`**${CONFIG_TYPE_HEADINGS[group.type]}**`);
        for (const config of group.items) {
            const overridden = overriddenNames?.has(config.name) ? ' (overridden by test-level variable)' : '';
            lines.push(`- \`${config.name}\`: ${configDisplayValue(config)}${overridden}`);
        }
        lines.push('');
    }
}

export function buildTestInstructionsMarkdown({
    isLoginFlow,
    name,
    displayId,
    browsers,
    steps,
    projectConfigs,
    testCaseConfigs,
    testCaseFiles,
    resolveLoginFlowLabel,
}: BuildInstructionsMarkdownParams): string {
    const lines: string[] = [];
    const entityLabel = isLoginFlow ? 'Login Flow' : 'Test Case';
    const targetLabelById = new Map(browsers.map((browser, index) => [browser.id, targetLabel(browser, index)]));
    const fileNameById = new Map((testCaseFiles ?? []).map((file) => [file.id, file.filename]));

    lines.push(isLoginFlow ? '# Login Flow Instructions' : '# Test Instructions');
    lines.push('');
    lines.push('## Overview');
    lines.push(`- Kind: ${isLoginFlow ? 'LOGIN_FLOW' : 'TEST'}`);
    lines.push(`- ${entityLabel} Name: ${name || '(not set)'}`);
    lines.push(`- ${entityLabel} ID: ${displayId || '(not set)'}`);
    lines.push('');

    lines.push('## Configurations');
    lines.push('');
    const overriddenNames = new Set(testCaseConfigs.map((config) => config.name));
    appendConfigGroup(lines, 'Project Variables', projectConfigs, overriddenNames);
    appendConfigGroup(lines, 'Test Case Variables', testCaseConfigs);

    lines.push('## Testing Targets');
    if (browsers.length === 0) {
        lines.push('_None_');
        lines.push('');
    } else {
        browsers.forEach((browser, index) => {
            const label = targetLabel(browser, index);
            const isAndroid = 'type' in browser.config && browser.config.type === 'android';
            if (isAndroid) {
                const cfg = normalizeAndroidTargetConfig(browser.config as AndroidTargetConfig);
                lines.push(`### ${label}`);
                lines.push(`- Type: Android`);
                lines.push(`- Device: ${getAndroidDeviceSelectorLabel(cfg.deviceSelector) || '(not set)'}`);
                lines.push(`- App ID: ${cfg.appId || '(not set)'}`);
                lines.push(`- Clear App State: ${yesNo(cfg.clearAppState)}`);
                lines.push(`- Allow All Permissions: ${yesNo(cfg.allowAllPermissions)}`);
                lines.push('');
                return;
            }

            const cfg = normalizeBrowserConfig(browser.config as BrowserConfig);
            lines.push(`### ${label}`);
            lines.push(`- Type: Browser`);
            lines.push(`- URL: ${cfg.url || '(not set)'}`);
            lines.push(`- Viewport: ${cfg.width} x ${cfg.height}`);
            if (!isLoginFlow) {
                const loginFlow = cfg.loginFlowId
                    ? (resolveLoginFlowLabel?.(cfg.loginFlowId) || cfg.loginFlowId)
                    : '(none)';
                lines.push(`- Login Flow: ${loginFlow}`);
                lines.push(`- Reuse Group Session: ${yesNo(cfg.reuseGroupSession ?? false)}`);
            }
            lines.push(`- Virtual WebAuthn Authenticator: ${yesNo(cfg.webauthnVirtualAuthenticator ?? false)}`);
            lines.push('');
        });
    }

    lines.push('## Test Steps');
    if (steps.length === 0) {
        lines.push('_No steps defined_');
        lines.push('');
    } else {
        steps.forEach((step, index) => {
            const stepType = step.type ?? 'ai-action';
            const actionText = (step.action || step.aiAction || step.codeAction || '').trim();
            const stepTargetLabel = targetLabelById.get(step.target) ?? step.target;
            lines.push(`${index + 1}. [${stepTargetLabel}] (${stepType})`);
            if (actionText) {
                lines.push('');
                lines.push('    ```');
                for (const actionLine of actionText.split('\n')) {
                    lines.push(`    ${actionLine}`);
                }
                lines.push('    ```');
            }
            if (step.files && step.files.length > 0) {
                const fileLabels = step.files.map((fileId) => fileNameById.get(fileId) ?? fileId);
                lines.push(`    Attached files: ${fileLabels.join(', ')}`);
            }
            lines.push('');
        });
    }

    if (testCaseFiles && testCaseFiles.length > 0) {
        lines.push('## Files');
        for (const file of testCaseFiles) {
            lines.push(`- ${file.filename} (type: ${file.mimeType}, size: ${file.size})`);
        }
        lines.push('');
    }

    return lines.join('\n').trimEnd() + '\n';
}

export const DEFAULT_SLACK_FAILURE_TEMPLATE = [
    ':x: *Test Failed* {testCaseID}',
    '*Test Case:* {testCaseName}',
    '*Run ID:* {runId}',
    '*Project:* {projectName}',
    '*Triggered by:* {triggeredBy}',
    '*Started:* {startedAt} *Completed:* {completedAt}',
    '*Error:* {errorSummary}',
].join('\n');

export const DEFAULT_SLACK_SUCCESS_TEMPLATE = [
    ':white_check_mark: *Test Passed* {testCaseID}',
    '*Test Case:* {testCaseName}',
    '*Run ID:* {runId}',
    '*Project:* {projectName}',
    '*Triggered by:* {triggeredBy}',
    '*Started:* {startedAt} *Completed:* {completedAt}',
    '*Duration:* {durationSeconds}s',
].join('\n');

const TEMPLATE_VARIABLE_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;
const SLACK_MESSAGE_SOFT_LIMIT = 3_500;

export interface SlackTemplateContext {
    [key: string]: string | number | SlackRawValue | null | undefined;
}

export interface SlackRawValue {
    __rawSlack: true;
    value: string;
}

export interface RenderTemplateResult {
    text: string;
    truncated: boolean;
    missingVariables: string[];
}

interface RenderTemplateOptions {
    fallbackTemplate?: string;
}

function escapeSlackMrkdwnValue(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function isSlackRawValue(value: unknown): value is SlackRawValue {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<SlackRawValue>;
    return candidate.__rawSlack === true && typeof candidate.value === 'string';
}

export function rawSlack(value: string): SlackRawValue {
    return {
        __rawSlack: true,
        value,
    };
}

export function renderTemplate(
    template: string,
    context: SlackTemplateContext,
    options?: RenderTemplateOptions
): RenderTemplateResult {
    const missingVariables = new Set<string>();
    const fallbackTemplate = options?.fallbackTemplate ?? DEFAULT_SLACK_FAILURE_TEMPLATE;
    const safeTemplate = template.trim().length > 0 ? template : fallbackTemplate;

    const replaced = safeTemplate.replaceAll(TEMPLATE_VARIABLE_PATTERN, (fullMatch, variableName: string) => {
        const value = context[variableName];
        if (value === undefined || value === null) {
            missingVariables.add(variableName);
            return fullMatch;
        }

        if (isSlackRawValue(value)) {
            return value.value;
        }

        return escapeSlackMrkdwnValue(String(value));
    });

    const truncated = replaced.length > SLACK_MESSAGE_SOFT_LIMIT;
    const text = truncated
        ? replaced.slice(0, SLACK_MESSAGE_SOFT_LIMIT)
        : replaced;

    return {
        text,
        truncated,
        missingVariables: [...missingVariables],
    };
}

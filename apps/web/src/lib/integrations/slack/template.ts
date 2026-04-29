export const DEFAULT_SLACK_FAILURE_TEMPLATE = [
    ':rotating_light: *Test failed* — <{runUrl}|{testCaseName}>',
    '*Project:* {projectName}',
    '*Triggered by:* {triggeredBy}',
    '*Started:* {startedAt}  *Completed:* {completedAt}',
    '*Error:* {errorSummary}',
].join('\n');

const TEMPLATE_VARIABLE_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;
const SLACK_MESSAGE_SOFT_LIMIT = 3_500;

export interface SlackTemplateContext {
    [key: string]: string | number | null | undefined;
}

export interface RenderTemplateResult {
    text: string;
    truncated: boolean;
    missingVariables: string[];
}

function escapeSlackMrkdwnValue(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

export function renderTemplate(template: string, context: SlackTemplateContext): RenderTemplateResult {
    const missingVariables = new Set<string>();
    const safeTemplate = template.trim().length > 0 ? template : DEFAULT_SLACK_FAILURE_TEMPLATE;

    const replaced = safeTemplate.replaceAll(TEMPLATE_VARIABLE_PATTERN, (fullMatch, variableName: string) => {
        const value = context[variableName];
        if (value === undefined || value === null) {
            missingVariables.add(variableName);
            return fullMatch;
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

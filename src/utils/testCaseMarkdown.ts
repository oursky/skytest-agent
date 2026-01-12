import { TestStep, BrowserConfig, StepType } from '@/types';

export interface TestCaseData {
    name?: string;
    url: string;
    username?: string;
    password?: string;
    prompt: string;
    steps?: TestStep[];
    browserConfig?: Record<string, BrowserConfig>;
}

interface ParsedMarkdown {
    data: TestCaseData;
    errors: string[];
}

/**
 * Export test case data to markdown format
 */
export function exportToMarkdown(data: TestCaseData): string {
    const isMultiBrowser = (data.steps && data.steps.length > 0) ||
        (data.browserConfig && Object.keys(data.browserConfig).length > 0);

    const lines: string[] = ['---'];
    lines.push(`format: v1/${isMultiBrowser ? 'multi-browser' : 'simple'}`);

    if (data.name) {
        lines.push(`name: ${escapeYamlString(data.name)}`);
    }

    if (isMultiBrowser && data.browserConfig) {
        lines.push('browsers:');
        for (const [id, config] of Object.entries(data.browserConfig)) {
            lines.push(`  - id: ${id}`);
            lines.push(`    url: ${escapeYamlString(config.url)}`);
            if (config.username) {
                lines.push(`    username: ${escapeYamlString(config.username)}`);
            }
            lines.push('    password: ""');
        }
    } else {
        lines.push(`url: ${escapeYamlString(data.url)}`);
        if (data.username) {
            lines.push(`username: ${escapeYamlString(data.username)}`);
        }
        lines.push('password: ""');
    }

    lines.push('---');
    lines.push('');

    if (isMultiBrowser && data.steps && data.steps.length > 0) {
        lines.push('# Test Steps');
        lines.push('');
        data.steps.forEach((step, index) => {
            const typeMarker = step.type === 'playwright-code' ? ' [Code]' : '';
            lines.push(`## Step ${index + 1}${typeMarker} - ${formatBrowserId(step.target)}`);
            lines.push(step.action);
            lines.push('');
        });
    } else {
        lines.push('# Test Instructions');
        lines.push('');
        lines.push(data.prompt || '');
    }

    return lines.join('\n');
}

/**
 * Parse markdown back to test case data
 */
export function parseMarkdown(markdown: string): ParsedMarkdown {
    const errors: string[] = [];
    const data: TestCaseData = {
        url: '',
        prompt: '',
    };

    // Split frontmatter and body
    const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!frontmatterMatch) {
        errors.push('Invalid markdown format: missing YAML frontmatter');
        return { data, errors };
    }

    const frontmatter = frontmatterMatch[1];
    const body = frontmatterMatch[2].trim();

    // Parse frontmatter
    const parsed = parseYamlFrontmatter(frontmatter);

    // Extract mode from format field (e.g., "v1/simple" -> "simple")
    const formatValue = (parsed.format as string) || '';
    const mode = formatValue.includes('/') ? formatValue.split('/')[1] : (parsed.mode as string) || 'simple';
    data.name = parsed.name as string | undefined;

    if (mode === 'multi-browser' && parsed.browsers) {
        // Multi-browser mode
        const browserConfig: Record<string, BrowserConfig> = {};
        const browsers = parsed.browsers as Array<{ id: string; url?: string; username?: string; password?: string }>;
        for (const browser of browsers) {
            browserConfig[browser.id] = {
                url: browser.url || '',
                username: browser.username,
                password: browser.password,
            };
        }
        data.browserConfig = browserConfig;
        data.url = browsers[0]?.url || '';

        // Parse steps from body
        const steps = parseStepsFromBody(body);
        if (steps.length > 0) {
            data.steps = steps;
        }
    } else {
        // Simple mode
        data.url = (parsed.url as string) || '';
        data.username = parsed.username as string | undefined;
        data.password = parsed.password as string | undefined;

        // Parse prompt from body
        data.prompt = parsePromptFromBody(body);
    }

    // Validation
    if (!data.url && !data.browserConfig) {
        errors.push('Missing URL');
    }

    return { data, errors };
}

/**
 * Export multiple test cases to a single markdown file
 */
export function exportMultipleToMarkdown(testCases: TestCaseData[]): string {
    return testCases.map(tc => exportToMarkdown(tc)).join('\n---\n\n');
}

/**
 * Parse multiple test cases from a combined markdown file
 */
export function parseMultipleMarkdown(markdown: string): ParsedMarkdown[] {
    // Split by document separator (--- at start of line, not frontmatter)
    const documents = markdown.split(/\n---\n\n(?=---\n)/);
    return documents.map(doc => parseMarkdown(doc.trim()));
}

function escapeYamlString(str: string): string {
    if (!str) return '""';
    const needsQuotes = /[:\#"'\n\r\t\[\]\{\}&*!|>@`]/.test(str) ||
        str.startsWith(' ') ||
        str.endsWith(' ');
    if (needsQuotes) {
        return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return str;
}

function formatBrowserId(id: string): string {
    return id.replace(/^browser_/, 'Browser ').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function parseBrowserIdFromLabel(label: string): string {
    return label.toLowerCase().replace(/\s+/g, '_');
}

function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');
    let currentArray: Record<string, string>[] | null = null;
    let currentArrayKey = '';
    let currentObject: Record<string, string> | null = null;

    for (const line of lines) {
        // Array item
        if (line.match(/^\s+-\s+/)) {
            if (currentObject) {
                currentArray?.push(currentObject);
            }
            currentObject = {};
            const match = line.match(/^\s+-\s+(\w+):\s*(.*)$/);
            if (match) {
                currentObject[match[1]] = parseYamlValue(match[2]);
            }
            continue;
        }

        // Nested property in array item
        if (line.match(/^\s{4}\w+:/) && currentObject) {
            const match = line.match(/^\s+(\w+):\s*(.*)$/);
            if (match) {
                currentObject[match[1]] = parseYamlValue(match[2]);
            }
            continue;
        }

        // Top-level property
        const match = line.match(/^(\w+):\s*(.*)$/);
        if (match) {
            if (currentObject && currentArray) {
                currentArray.push(currentObject);
                currentObject = null;
            }
            if (currentArray && currentArrayKey) {
                result[currentArrayKey] = currentArray;
                currentArray = null;
                currentArrayKey = '';
            }

            if (match[2] === '' || match[2] === undefined) {
                // Start of array
                currentArray = [];
                currentArrayKey = match[1];
            } else {
                result[match[1]] = parseYamlValue(match[2]);
            }
        }
    }

    // Finalize
    if (currentObject && currentArray) {
        currentArray.push(currentObject);
    }
    if (currentArray && currentArrayKey) {
        result[currentArrayKey] = currentArray;
    }

    return result;
}

function parseYamlValue(value: string): string {
    if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'");
    }
    return value;
}

function parseStepsFromBody(body: string): TestStep[] {
    const steps: TestStep[] = [];
    const stepRegex = /##\s+Step\s+\d+\s*(\[Code\])?\s*-\s+(.+?)\n([\s\S]*?)(?=##\s+Step|\n*$)/gi;
    let match;

    while ((match = stepRegex.exec(body)) !== null) {
        const isCode = !!match[1];
        const browserLabel = match[2].trim();
        const action = match[3].trim();
        steps.push({
            id: `step_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            target: parseBrowserIdFromLabel(browserLabel),
            action,
            type: isCode ? 'playwright-code' : 'ai-action',
        });
    }

    return steps;
}

function parsePromptFromBody(body: string): string {
    return body.replace(/^#\s+Test Instructions\s*\n+/, '').trim();
}

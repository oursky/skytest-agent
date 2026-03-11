import { describe, expect, it } from 'vitest';
import { splitPlaywrightCodeStatements, summarizePlaywrightCodeStatement } from '@/lib/runtime/playwright-code-trace';

describe('splitPlaywrightCodeStatements', () => {
    it('splits single-line statements', () => {
        const statements = splitPlaywrightCodeStatements(
            "await page.goto('https://example.com');\nawait expect(page.getByText('Hello')).toBeVisible();"
        );

        expect(statements).toEqual([
            {
                lineStart: 1,
                lineEnd: 1,
                code: "await page.goto('https://example.com');",
            },
            {
                lineStart: 2,
                lineEnd: 2,
                code: "await expect(page.getByText('Hello')).toBeVisible();",
            },
        ]);
    });

    it('keeps multiline statements together', () => {
        const statements = splitPlaywrightCodeStatements(
            "if (await page.getByText('Hello').isVisible()) {\n  await page.getByRole('button', { name: 'Next' }).click();\n}"
        );

        expect(statements).toEqual([
            {
                lineStart: 1,
                lineEnd: 3,
                code: "if (await page.getByText('Hello').isVisible()) {\n  await page.getByRole('button', { name: 'Next' }).click();\n}",
            },
        ]);
    });

    it('ignores leading and empty lines', () => {
        const statements = splitPlaywrightCodeStatements(
            "\n\nawait page.getByText('A').click();\n\nawait page.getByText('B').click();\n"
        );

        expect(statements).toEqual([
            {
                lineStart: 3,
                lineEnd: 3,
                code: "await page.getByText('A').click();",
            },
            {
                lineStart: 5,
                lineEnd: 5,
                code: "await page.getByText('B').click();",
            },
        ]);
    });
});

describe('summarizePlaywrightCodeStatement', () => {
    it('compacts whitespace and truncates long code', () => {
        const summary = summarizePlaywrightCodeStatement(
            "await page.getByRole('textbox', { name: '員工編號' }).fill(vars['EMPLOYEE_ID']);",
            45
        );

        expect(summary.length).toBe(45);
        expect(summary.endsWith('...')).toBe(true);
        expect(summary.startsWith("await page.getByRole('textbox', { name: ")).toBe(true);
    });
});

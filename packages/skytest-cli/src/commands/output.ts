export type OutputFormat = 'text' | 'json';

export function resolveOutputFormat(args: string[]): { format: OutputFormat; remainingArgs: string[] } {
    let format: OutputFormat = 'text';
    const remainingArgs: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];

        if (token === '--json') {
            format = 'json';
            continue;
        }

        if (token === '--format') {
            const nextToken = args[index + 1];
            if (nextToken === 'json' || nextToken === 'text') {
                format = nextToken;
                index += 1;
                continue;
            }
            throw new Error('Expected `json` or `text` after `--format`.');
        }

        remainingArgs.push(token);
    }

    return { format, remainingArgs };
}

export function printValue(value: unknown, format: OutputFormat): void {
    if (format === 'json') {
        console.log(JSON.stringify(value, null, 2));
        return;
    }

    if (typeof value === 'string') {
        console.log(value);
        return;
    }

    console.log(JSON.stringify(value, null, 2));
}

export function printTable(headers: string[], rows: string[][]): void {
    const widths = headers.map((header, columnIndex) => {
        const rowWidth = rows.reduce((max, row) => Math.max(max, row[columnIndex]?.length ?? 0), 0);
        return Math.max(header.length, rowWidth);
    });

    const formatRow = (row: string[]): string => row
        .map((cell, index) => cell.padEnd(widths[index], ' '))
        .join('  ');

    console.log(formatRow(headers));
    console.log(widths.map((width) => '-'.repeat(width)).join('  '));

    for (const row of rows) {
        console.log(formatRow(row));
    }
}

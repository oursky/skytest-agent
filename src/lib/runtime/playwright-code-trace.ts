export interface PlaywrightCodeStatement {
    lineStart: number;
    lineEnd: number;
    code: string;
}

function isIncompleteSyntaxError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('Unexpected end of input')
        || message.includes('Unexpected token')
        || message.includes('missing ) after argument list')
        || message.includes('Unexpected identifier');
}

function canCompileStatementChunk(chunk: string): boolean {
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor as new (...args: string[]) => (...fnArgs: unknown[]) => Promise<unknown>;
    try {
        void new AsyncFunction('page', chunk);
        return true;
    } catch (error) {
        if (isIncompleteSyntaxError(error)) {
            return false;
        }

        return false;
    }
}

export function splitPlaywrightCodeStatements(code: string): PlaywrightCodeStatement[] {
    const lines = code.replace(/\r\n/g, '\n').split('\n');
    const statements: PlaywrightCodeStatement[] = [];

    let buffer: string[] = [];
    let bufferStartLine = 0;

    const flush = (lineEnd: number) => {
        const chunk = buffer.join('\n').trim();
        if (!chunk) {
            buffer = [];
            bufferStartLine = 0;
            return;
        }

        statements.push({
            lineStart: bufferStartLine,
            lineEnd,
            code: chunk,
        });
        buffer = [];
        bufferStartLine = 0;
    };

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const lineNumber = index + 1;
        const trimmed = line.trim();

        if (buffer.length === 0 && !trimmed) {
            continue;
        }

        if (buffer.length === 0) {
            bufferStartLine = lineNumber;
        }
        buffer.push(line);

        const candidate = buffer.join('\n').trim();
        if (!candidate) {
            continue;
        }

        if (canCompileStatementChunk(candidate)) {
            flush(lineNumber);
        }
    }

    if (buffer.length > 0) {
        flush(lines.length);
    }

    return statements;
}

export function summarizePlaywrightCodeStatement(statementCode: string, maxLength = 100): string {
    const compact = statementCode.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) {
        return compact;
    }
    return `${compact.slice(0, maxLength - 3)}...`;
}

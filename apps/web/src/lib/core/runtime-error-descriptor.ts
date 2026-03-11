type RuntimeErrorDetailValue = string | number | boolean | null;

export interface RuntimeErrorDescriptor {
    summary: string;
    detail: Record<string, RuntimeErrorDetailValue>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
    const value = record[key];
    return typeof value === 'number' ? value : null;
}

function toRuntimeErrorDetail(record: Record<string, unknown>): Record<string, RuntimeErrorDetailValue> {
    const detail: Record<string, RuntimeErrorDetailValue> = {};

    const name = readString(record, 'name');
    if (name) {
        detail.name = name;
    }

    const message = readString(record, 'message');
    if (message) {
        detail.message = message;
    }

    const stack = readString(record, 'stack');
    if (stack) {
        detail.stack = stack;
    }

    const type = readString(record, 'type');
    if (type) {
        detail.type = type;
    }

    const filename = readString(record, 'filename');
    if (filename) {
        detail.filename = filename;
    }

    const lineno = readNumber(record, 'lineno');
    if (lineno !== null) {
        detail.lineno = lineno;
    }

    const colno = readNumber(record, 'colno');
    if (colno !== null) {
        detail.colno = colno;
    }

    const target = record.target;
    if (isRecord(target)) {
        const src = readString(target, 'src');
        if (src) {
            detail.targetSrc = src;
        }
        const href = readString(target, 'href');
        if (href) {
            detail.targetHref = href;
        }
        const tagName = readString(target, 'tagName');
        if (tagName) {
            detail.targetTagName = tagName;
        }
    }

    return detail;
}

export function describeRuntimeErrorValue(value: unknown): RuntimeErrorDescriptor {
    if (value instanceof Error) {
        return {
            summary: `${value.name}: ${value.message}`,
            detail: {
                name: value.name,
                message: value.message,
                stack: value.stack ?? null,
            },
        };
    }

    if (typeof value === 'string') {
        return {
            summary: value,
            detail: { message: value },
        };
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        const message = String(value);
        return {
            summary: message,
            detail: { message },
        };
    }

    if (value === null) {
        return {
            summary: 'null',
            detail: { type: 'null' },
        };
    }

    if (value === undefined) {
        return {
            summary: 'undefined',
            detail: { type: 'undefined' },
        };
    }

    if (Array.isArray(value)) {
        return {
            summary: `Array(length=${value.length})`,
            detail: { length: value.length },
        };
    }

    if (!isRecord(value)) {
        return {
            summary: String(value),
            detail: { type: typeof value },
        };
    }

    const detail = toRuntimeErrorDetail(value);
    const eventType = readString(value, 'type');
    const message = readString(value, 'message');
    const name = readString(value, 'name');

    if (eventType && (!message || message === '[object Event]')) {
        return {
            summary: `Event(${eventType})`,
            detail,
        };
    }

    if (name && message) {
        return {
            summary: `${name}: ${message}`,
            detail,
        };
    }

    if (message) {
        return {
            summary: message,
            detail,
        };
    }

    const keys = Object.keys(value);
    const preview = keys.slice(0, 4).join(',');
    return {
        summary: preview ? `Object(${preview})` : 'Object',
        detail: {
            ...detail,
            keys: preview || null,
        },
    };
}

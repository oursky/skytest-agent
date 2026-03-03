type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogWriter = (message?: unknown, ...optionalParams: unknown[]) => void;

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const defaultLevel = 'info';
const rawLevel = (process.env.LOG_LEVEL || defaultLevel).toLowerCase();
const activeLevel = (['debug', 'info', 'warn', 'error'] as const).includes(rawLevel as LogLevel)
    ? (rawLevel as LogLevel)
    : 'info';

function shouldLog(level: LogLevel) {
    return LOG_LEVELS[level] >= LOG_LEVELS[activeLevel];
}

function safeStringify(value: unknown) {
    const seen = new WeakSet();
    try {
        return JSON.stringify(value, (_key, val) => {
            if (typeof val === 'object' && val !== null) {
                if (seen.has(val)) return '[Circular]';
                seen.add(val);
            }
            if (typeof val === 'bigint') return val.toString();
            return val;
        });
    } catch {
        return '"[Unserializable]"';
    }
}

function formatMeta(meta: unknown) {
    if (meta === undefined) return '';
    if (meta instanceof Error) {
        return safeStringify({ name: meta.name, message: meta.message, stack: meta.stack });
    }
    if (typeof meta === 'string') return meta;
    return safeStringify(meta);
}

function formatMessage(level: LogLevel, context: string | undefined, message: string, meta?: unknown) {
    const timestamp = new Date().toISOString();
    const segments = [timestamp, level.toUpperCase()];
    if (context) segments.push(`[${context}]`);
    segments.push(message);
    const metaOutput = formatMeta(meta);
    const base = segments.join(' ');
    return metaOutput ? `${base} | ${metaOutput}` : base;
}

function writeLog(level: LogLevel, context: string | undefined, message: string, meta?: unknown) {
    if (!shouldLog(level)) return;
    const output = formatMessage(level, context, message, meta);
    const writer: LogWriter = level === 'error'
        ? console.error
        : level === 'warn'
            ? console.warn
            : console.log;
    writer(output);
}

export interface Logger {
    debug: (message: string, meta?: unknown) => void;
    info: (message: string, meta?: unknown) => void;
    warn: (message: string, meta?: unknown) => void;
    error: (message: string, meta?: unknown) => void;
}

export function createLogger(context?: string): Logger {
    return {
        debug: (message, meta) => writeLog('debug', context, message, meta),
        info: (message, meta) => writeLog('info', context, message, meta),
        warn: (message, meta) => writeLog('warn', context, message, meta),
        error: (message, meta) => writeLog('error', context, message, meta),
    };
}

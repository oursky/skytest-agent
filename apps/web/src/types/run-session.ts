export const RUN_SESSION_KIND = {
    SINGLE: 'SINGLE',
    GROUP: 'GROUP',
} as const;

export type RunSessionKind = typeof RUN_SESSION_KIND[keyof typeof RUN_SESSION_KIND];

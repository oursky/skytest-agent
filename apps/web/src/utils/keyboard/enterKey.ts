import type { KeyboardEvent } from 'react';

interface EnterKeyOptions {
    enabled?: boolean;
    preventDefault?: boolean;
    ignoreComposing?: boolean;
}

export function runOnEnterKey(
    event: KeyboardEvent<HTMLElement>,
    action: () => void,
    options: EnterKeyOptions = {},
): void {
    const {
        enabled = true,
        preventDefault = true,
        ignoreComposing = true,
    } = options;

    if (!enabled || event.key !== 'Enter') {
        return;
    }

    if (ignoreComposing && event.nativeEvent.isComposing) {
        return;
    }

    if (preventDefault) {
        event.preventDefault();
    }

    action();
}

export type { EnterKeyOptions };

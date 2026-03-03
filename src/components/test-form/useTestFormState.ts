import { useEffect, useState } from 'react';
import type { TestStep } from '@/types';
import type { BrowserEntry } from '@/components/configurations-section/types';
import type { TestData } from './types';
import { buildBrowsers, buildSteps, createStepId } from './state-utils';

interface UseTestFormStateParams {
    initialData?: TestData;
}

interface UseTestFormStateResult {
    name: string;
    setName: (name: string) => void;
    browsers: BrowserEntry[];
    setBrowsers: (browsers: BrowserEntry[]) => void;
    steps: TestStep[];
    setSteps: (steps: TestStep[]) => void;
}

export function useTestFormState({ initialData }: UseTestFormStateParams): UseTestFormStateResult {
    const [name, setName] = useState(() => initialData?.name || '');
    const [browsers, setBrowsers] = useState<BrowserEntry[]>(() => buildBrowsers(initialData));
    const [steps, setSteps] = useState<TestStep[]>(() => {
        const initialBrowsers = buildBrowsers(initialData);
        const defaultBrowserId = initialBrowsers[0]?.id || 'browser_a';
        return buildSteps(initialData, defaultBrowserId, new Set(initialBrowsers.map((browser) => browser.id)));
    });

    useEffect(() => {
        if (!initialData) return;

        const nextBrowsers = buildBrowsers(initialData);
        const defaultBrowserId = nextBrowsers[0]?.id || 'browser_a';
        const validBrowserIds = new Set(nextBrowsers.map((browser) => browser.id));

        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setName(initialData.name || '');
            setBrowsers(nextBrowsers);
            setSteps(buildSteps(initialData, defaultBrowserId, validBrowserIds));
        });

        return () => {
            cancelled = true;
        };
    }, [initialData]);

    useEffect(() => {
        if (steps.length !== 0) return;

        queueMicrotask(() => {
            setSteps((current) => {
                if (current.length !== 0) return current;
                return [{
                    id: createStepId('step'),
                    target: browsers[0]?.id || 'browser_a',
                    action: '',
                    type: 'ai-action'
                }];
            });
        });
    }, [steps.length, browsers]);

    useEffect(() => {
        const fallbackTargetId = browsers[0]?.id;
        if (!fallbackTargetId) return;

        const validTargetIds = new Set(browsers.map((browser) => browser.id));
        let cancelled = false;

        queueMicrotask(() => {
            if (cancelled) return;

            setSteps((currentSteps) => {
                let changed = false;
                const nextSteps = currentSteps.map((step) => {
                    if (validTargetIds.has(step.target)) {
                        return step;
                    }
                    changed = true;
                    return { ...step, target: fallbackTargetId };
                });
                return changed ? nextSteps : currentSteps;
            });
        });

        return () => {
            cancelled = true;
        };
    }, [browsers]);

    return {
        name,
        setName,
        browsers,
        setBrowsers,
        steps,
        setSteps,
    };
}

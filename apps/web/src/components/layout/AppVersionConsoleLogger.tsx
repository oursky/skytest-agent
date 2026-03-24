'use client';

import { useEffect } from 'react';
import { resolveConsoleAppVersion } from './app-version';

const APP_VERSION = process.env.NEXT_PUBLIC_SKYTEST_VERSION;

export function AppVersionConsoleLogger() {
    useEffect(() => {
        const resolvedVersion = resolveConsoleAppVersion(APP_VERSION, window.location.hostname);
        console.info(`[skytest] version=${resolvedVersion}`);
    }, []);

    return null;
}

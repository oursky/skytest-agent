'use client';

import Image from 'next/image';
import { getStatusBadgeClass } from '@/utils/status/statusBadge';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    TEST_STATUS,
    type TestRun,
    type TestEvent,
    type TestCaseFile,
    type TestData,
    type BrowserConfig,
    type LoginFlowPrefixInfo,
} from '@/types';
import { formatTime } from '@/utils/time/dateFormatter';
import TimelineEvent from './TimelineEvent';
import ResultStatus from './ResultStatus';
import { useI18n } from '@/i18n';
import { useAuth } from '@/app/auth-provider';
import { fetchWithAccessToken } from '@/app/run/run-page-api';
import { isAndroidTargetConfig, normalizeAndroidTargetConfig } from '@/lib/android/target-config';
import { formatAndroidDeviceSelectorDisplay } from '@/lib/android/device-selector-display';
import { normalizeBrowserConfig } from '@/lib/test-config/browser-target';
import { browserTargetLabel } from '@/utils/runtime/browserTargetLabel';

interface ResultViewerMeta {
    runId?: string | null;
    testCaseId?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    testCaseName?: string | null;
    config?: TestData;
    files?: TestCaseFile[];
}

interface ResultViewerProps {
    result: Omit<TestRun, 'id' | 'testCaseId' | 'createdAt' | 'status'> & { status: TestRun['status'] | null; events: TestEvent[]; loginFlowPrefixes?: LoginFlowPrefixInfo[] };
    meta?: ResultViewerMeta;
}

function resolveSlackDeliveryFailureReason(slackNotifyError: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
    const [errorCode] = slackNotifyError.split(':');
    const exhausted = slackNotifyError.endsWith(':max_attempts');

    const reasonKey = (() => {
        switch (errorCode) {
            case 'invalid_auth':
                return 'results.slackDeliveryReason.invalidAuth';
            case 'not_in_channel':
                return 'results.slackDeliveryReason.notInChannel';
            case 'channel_not_found':
                return 'results.slackDeliveryReason.channelNotFound';
            case 'missing_scope':
                return 'results.slackDeliveryReason.missingScope';
            case 'token_revoked':
                return 'results.slackDeliveryReason.tokenRevoked';
            case 'ratelimited':
                return 'results.slackDeliveryReason.rateLimited';
            default:
                return 'results.slackDeliveryReason.unknown';
        }
    })();

    const reason = t(reasonKey);
    if (!exhausted) {
        return reason;
    }

    return t('results.slackDeliveryReason.maxAttempts', { reason });
}

function buildConfigSummaryLines(config?: TestData): string[] {
    if (!config) {
        return [];
    }

    const lines: string[] = [];
    const targets = config.browserConfig ?? {};
    const targetEntries = Object.entries(targets);

    if (targetEntries.length > 0) {
        lines.push('### Targets');
        for (const [targetId, targetConfig] of targetEntries) {
            if (isAndroidTargetConfig(targetConfig)) {
                const normalized = normalizeAndroidTargetConfig(targetConfig);
                const deviceDisplay = formatAndroidDeviceSelectorDisplay(normalized.deviceSelector);
                const targetName = targetConfig.name || targetId;
                lines.push(`- ${targetName} [${targetId}] Android`);
                lines.push(`  Device: ${deviceDisplay.label}`);
                lines.push(`  Device Detail: ${deviceDisplay.detail}`);
                lines.push(`  Device Selector: ${deviceDisplay.rawValue}`);
                if (targetConfig.appId) {
                    lines.push(`  App ID: ${targetConfig.appId}`);
                }
                continue;
            }

            const browserConfig = normalizeBrowserConfig(targetConfig as BrowserConfig);
            const targetName = browserConfig.name || targetId;
            lines.push(`- ${targetName} [${targetId}] Browser`);
            if (browserConfig.url) {
                lines.push(`  URL: ${browserConfig.url}`);
            }
            lines.push(`  Viewport: ${browserConfig.width} x ${browserConfig.height}`);
        }
    } else if (config.url) {
        lines.push('### Targets');
        lines.push(`- Browser [main]`);
        lines.push(`  URL: ${config.url}`);
    }

    return lines;
}

export default function ResultViewer({ result, meta }: ResultViewerProps) {
    const { t } = useI18n();
    const { getAccessToken } = useAuth();

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [lightboxImage, setLightboxImage] = useState<{ src: string; label: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [livePrefixes, setLivePrefixes] = useState<LoginFlowPrefixInfo[]>([]);
    const events = result.events;

    // While the test sits QUEUED behind its login flow(s), the live SSE stream carries no
    // login-flow status, so poll the run for its login-flow prefixes to show what it's
    // actually waiting on.
    const runId = meta?.runId;
    const isQueued = result.status === TEST_STATUS.QUEUED;
    useEffect(() => {
        if (!isQueued || !runId) {
            return;
        }
        let cancelled = false;
        const poll = async () => {
            try {
                const response = await fetchWithAccessToken(getAccessToken, `/api/test-runs/${runId}`);
                if (!response.ok) return;
                const data = await response.json() as { loginFlowPrefixes?: LoginFlowPrefixInfo[] };
                if (!cancelled && Array.isArray(data.loginFlowPrefixes)) {
                    setLivePrefixes(data.loginFlowPrefixes);
                }
            } catch {
                // Transient failure; the next tick retries.
            }
        };
        void poll();
        const interval = setInterval(() => { void poll(); }, 3000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [isQueued, runId, getAccessToken]);

    const loginFlowPrefixes = (result.loginFlowPrefixes?.length ?? 0) > 0
        ? result.loginFlowPrefixes!
        : livePrefixes;

    const targetTypeMap = useMemo<Record<string, 'browser' | 'android'>>(() => {
        const cfg = meta?.config?.browserConfig ?? {};
        return Object.fromEntries(
            Object.entries(cfg).map(([id, c]) => [
                id,
                isAndroidTargetConfig(c) ? 'android' : 'browser'
            ])
        );
    }, [meta?.config?.browserConfig]);

    const hasAndroidTargets = useMemo(() => {
        const cfg = meta?.config?.browserConfig ?? {};
        return Object.values(cfg).some(isAndroidTargetConfig);
    }, [meta?.config?.browserConfig]);

    useEffect(() => {
        if (!autoScroll) return;
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [events.length, autoScroll]);

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const container = e.currentTarget;
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;

        if (isNearBottom && !autoScroll) {
            setAutoScroll(true);
        } else if (!isNearBottom && autoScroll) {
            setAutoScroll(false);
        }
    };

    const triggerScrollBottom = () => {
        setAutoScroll(true);
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTo({
                top: scrollContainerRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    };

    const buildLogsText = (): string => {
        const lines: string[] = [];
        lines.push(`# SkyTest Agent Run Report`);
        lines.push(`Generated: ${new Date().toISOString()}`);
        if (typeof window !== 'undefined') {
            lines.push(`Location: ${window.location.href}`);
            lines.push(`User-Agent: ${navigator.userAgent}`);
        }
        lines.push('');
        lines.push('## Metadata');
        if (meta?.runId) lines.push(`Run ID: ${meta.runId}`);
        if (meta?.testCaseId) lines.push(`Test Case ID: ${meta.testCaseId}`);
        if (meta?.testCaseName) lines.push(`Test Case Name: ${meta.testCaseName}`);
        if (meta?.projectId) lines.push(`Project ID: ${meta.projectId}`);
        if (meta?.projectName) lines.push(`Project Name: ${meta.projectName}`);
        lines.push(`Status: ${result.status}`);
        if (result.error) lines.push(`Error: ${result.error}`);
        if (result.errorCode) lines.push(`Error Code: ${result.errorCode}`);
        if (result.errorCategory) lines.push(`Error Category: ${result.errorCategory}`);
        lines.push(`Events: ${result.events.length}`);
        lines.push('');
        if (meta?.config) {
            lines.push('## Configuration');
            const configSummaryLines = buildConfigSummaryLines(meta.config);
            if (configSummaryLines.length > 0) {
                lines.push(...configSummaryLines);
                lines.push('');
            }
            try {
                const { browserConfig: testingTarget, ...restConfig } = meta.config;
                const configForLogs = testingTarget
                    ? { ...restConfig, testingTarget }
                    : restConfig;
                const configJson = JSON.stringify(configForLogs, null, 2);
                lines.push('```json');
                lines.push(configJson);
                lines.push('```');
            } catch {
                // ignore
            }
            lines.push('');
        }
        if (meta?.files && meta.files.length > 0) {
            lines.push('## Files');
            for (const f of meta.files) {
                lines.push(`- ${f.filename} (id: ${f.id}, stored: ${f.storedName}, type: ${f.mimeType}, size: ${f.size})`);
            }
            lines.push('');
        }
        lines.push('## Events');
        for (const ev of result.events) {
            const t = formatTime(ev.timestamp);
            if (ev.type === 'log' && 'message' in ev.data) {
                const level = ev.data.level?.toUpperCase() || 'INFO';
                const prefix = ev.browserId ? `[${t}] [${level}] [${browserTargetLabel(ev.browserId)}]` : `[${t}] [${level}]`;
                lines.push(`${prefix} ${ev.data.message}`);
            } else if (ev.type === 'screenshot' && 'label' in ev.data) {
                const prefix = ev.browserId ? `[${t}] [SCREENSHOT] [${browserTargetLabel(ev.browserId)}]` : `[${t}] [SCREENSHOT]`;
                lines.push(`${prefix} ${ev.data.label}`);
            }
        }
        return lines.join('\n');
    };

    const handleCopyLogs = async () => {
        try {
            await navigator.clipboard.writeText(buildLogsText());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            // ignore
        }
    };

    return (
        <>
            {lightboxImage && (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 animate-fade-in"
                    onClick={() => setLightboxImage(null)}
                >
                    <button
                        onClick={() => setLightboxImage(null)}
                        className="absolute top-4 right-4 p-2 text-white hover:text-gray-300 transition-colors"
                        aria-label={t('results.closeLightbox')}
                    >
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                    <div className="max-w-7xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
                        <Image
                            src={lightboxImage.src}
                            alt={lightboxImage.label}
                            width={1920}
                            height={1080}
                            unoptimized
                            loading="eager"
                            style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '90vh' }}
                            className="rounded-lg"
                        />
                        <p className="text-white text-center mt-4">{lightboxImage.label}</p>
                    </div>
                </div>
            )}

            <div className="glass-panel h-full max-h-[800px] flex flex-col relative overflow-hidden">
                {!autoScroll && result.status === TEST_STATUS.RUNNING && (
                    <button
                        onClick={triggerScrollBottom}
                        className="absolute bottom-8 right-8 z-50 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-md shadow-lg flex items-center gap-2 font-medium text-sm transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        <span>{t('results.newActivity')}</span>
                    </button>
                )}

                <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white/50 backdrop-blur-sm z-10">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-foreground">{t('results.title')}</h2>
                        {result.status !== null && (
                            <div className={`status-badge ${getStatusBadgeClass(result.status)}`}>
                                {result.status === TEST_STATUS.PASS && '✓'}
                                {result.status === TEST_STATUS.FAIL && '✕'}
                                {result.status === TEST_STATUS.CANCELLED && '⏹'}
                                <span>{result.status}</span>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCopyLogs}
                            type="button"
                            className="cursor-pointer h-8 px-2.5 py-0 bg-gray-100 border border-gray-200 rounded-md text-xs font-medium text-muted-foreground relative inline-flex items-center justify-center hover:bg-gray-200/70 transition-colors"
                            title={t('results.copyLogs')}
                        >
                            <span className="invisible inline-block leading-none">{t('results.copyLogs')}</span>
                            <span className="absolute inset-0 flex items-center justify-center leading-none">
                                {copied ? t('results.copied') : t('results.copyLogs')}
                            </span>
                        </button>
                        <div className="h-8 px-2.5 py-0 bg-gray-100 border border-gray-200 rounded-md inline-flex items-center cursor-default select-none">
                            <span className="text-xs text-muted-foreground font-medium">
                                {t('results.eventsCount', { count: events.length })}
                            </span>
                        </div>
                    </div>
                </div>

                <div
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto w-full p-6 space-y-4"
                >
                    {result.status === null ? (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                            <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                            </div>
                            <div className="space-y-2">
                                <p className="text-base font-medium text-foreground">{t('results.readyTitle')}</p>
                                <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                                    {t('results.readySubtitle')}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {result.status === TEST_STATUS.QUEUED && loginFlowPrefixes.length > 0 && (
                                <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm">
                                    <p className="font-medium text-blue-900">{t('results.queuedForLoginFlow')}</p>
                                    <ul className="mt-2 space-y-1.5">
                                        {loginFlowPrefixes.map((flow) => (
                                            <li key={flow.runId} className="flex items-center gap-2">
                                                <span className={`status-badge ${getStatusBadgeClass(flow.status)}`}>{flow.status}</span>
                                                <a
                                                    href={`/test-cases/${flow.testCaseId}/history/${flow.runId}`}
                                                    className="truncate text-blue-700 hover:underline"
                                                >
                                                    {flow.displayId ? `${flow.displayId} ${flow.name}` : flow.name}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {events.map((event, index) => (
                                <TimelineEvent
                                    key={index}
                                    event={event}
                                    isLast={index === events.length - 1}
                                    onImageClick={(src, label) => setLightboxImage({ src, label })}
                                    targetType={targetTypeMap[event.browserId ?? ''] ?? 'browser'}
                                />
                            ))}

                            {result.status === TEST_STATUS.RUNNING && (
                                <div className="relative pl-8 flex items-center gap-2 mt-4 ml-1">
                                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-500 text-sm">
                                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <span>{t('results.waiting')}</span>
                                    </div>
                                </div>
                            )}

                            {result.status === TEST_STATUS.FAIL && result.slackNotifyError && (
                                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                    {t('results.slackDeliveryFailed', {
                                        reason: resolveSlackDeliveryFailureReason(result.slackNotifyError, t),
                                    })}
                                </div>
                            )}

                            <ResultStatus
                                status={result.status}
                                error={result.error}
                                errorCode={result.errorCode}
                                errorCategory={result.errorCategory}
                                eventCount={events.length}
                                hasAndroidTargets={hasAndroidTargets}
                            />
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

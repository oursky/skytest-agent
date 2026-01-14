'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TestRun, TestEvent, TestCaseFile, TestData, isLogData, isScreenshotData } from '@/types';
import { formatTime } from '@/utils/dateFormatter';
import TimelineEvent from './result-viewer/TimelineEvent';
import ResultStatus from './result-viewer/ResultStatus';

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
    result: Omit<TestRun, 'id' | 'testCaseId' | 'createdAt'> & { events: TestEvent[] };
    meta?: ResultViewerMeta;
}

function collectSecrets(config?: TestData): string[] {
    if (!config) return [];
    const secrets = new Set<string>();

    if (config.username) secrets.add(config.username);
    if (config.password) secrets.add(config.password);

    if (config.browserConfig) {
        for (const entry of Object.values(config.browserConfig)) {
            if (entry.username) secrets.add(entry.username);
            if (entry.password) secrets.add(entry.password);
        }
    }

    return Array.from(secrets).filter((value) => value.trim().length > 0);
}

function maskSensitiveText(text: string, secrets: string[]): string {
    if (!secrets.length) return text;
    return secrets.reduce((output, secret) => {
        if (!secret) return output;
        return output.split(secret).join('••••');
    }, text);
}

function maskEvent(event: TestEvent, secrets: string[]): TestEvent {
    if (!secrets.length) return event;

    if (isLogData(event.data)) {
        return {
            ...event,
            data: {
                ...event.data,
                message: maskSensitiveText(event.data.message, secrets)
            }
        };
    }

    if (isScreenshotData(event.data)) {
        return {
            ...event,
            data: {
                ...event.data,
                label: maskSensitiveText(event.data.label || '', secrets)
            }
        };
    }

    return event;
}

export default function ResultViewer({ result, meta }: ResultViewerProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const [lightboxImage, setLightboxImage] = useState<{ src: string; label: string } | null>(null);
    const [copied, setCopied] = useState(false);

    const secrets = useMemo(() => collectSecrets(meta?.config), [meta?.config]);

    const events = useMemo(() => result.events.map((event) => maskEvent(event, secrets)), [result.events, secrets]);

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
        lines.push(`Events: ${events.length}`);
        lines.push('');
        if (meta?.config) {
            lines.push('## Configuration');
            try {
                const configJson = JSON.stringify(meta.config, null, 2);
                lines.push('```json');
                lines.push(maskSensitiveText(configJson, secrets));
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
        for (const ev of events) {
            const t = formatTime(ev.timestamp);
            if (ev.type === 'log' && 'message' in ev.data) {
                const level = ev.data.level?.toUpperCase() || 'INFO';
                const prefix = ev.browserId ? `[${t}] [${level}] [${ev.browserId}]` : `[${t}] [${level}]`;
                lines.push(`${prefix} ${ev.data.message}`);
            } else if (ev.type === 'screenshot' && 'label' in ev.data) {
                const prefix = ev.browserId ? `[${t}] [SCREENSHOT] [${ev.browserId}]` : `[${t}] [SCREENSHOT]`;
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
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 animate-fade-in"
                    onClick={() => setLightboxImage(null)}
                >
                    <button
                        onClick={() => setLightboxImage(null)}
                        className="absolute top-4 right-4 p-2 text-white hover:text-gray-300 transition-colors"
                        aria-label="Close lightbox"
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
                            style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '90vh' }}
                            className="rounded-lg"
                        />
                        <p className="text-white text-center mt-4">{lightboxImage.label}</p>
                    </div>
                </div>
            )}

            <div className="glass-panel h-full max-h-[800px] flex flex-col relative overflow-hidden">
                {!autoScroll && result.status === 'RUNNING' && (
                    <button
                        onClick={triggerScrollBottom}
                        className="absolute bottom-8 right-8 z-50 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-md shadow-lg flex items-center gap-2 font-medium text-sm transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                        <span>New Activity</span>
                    </button>
                )}

                <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white/50 backdrop-blur-sm z-10">
                    <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-foreground">Test Results</h2>
                        {result.status !== 'IDLE' && (
                            <div className={`status-badge ${result.status === 'PASS' ? 'status-badge-pass' :
                                result.status === 'FAIL' ? 'status-badge-fail' :
                                    result.status === 'CANCELLED' ? 'status-badge-cancelled' :
                                        result.status === 'QUEUED' ? 'status-badge-queued' :
                                            'status-badge-running'
                                }`}>
                                {result.status === 'PASS' && '✓'}
                                {result.status === 'FAIL' && '✕'}
                                {result.status === 'CANCELLED' && '⏹'}
                                <span>{result.status}</span>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCopyLogs}
                            type="button"
                            className="h-8 px-2.5 py-0 bg-gray-100 border border-gray-200 rounded-md text-xs font-medium text-muted-foreground relative inline-flex items-center justify-center"
                            title="Copy logs"
                        >
                            <span className="invisible inline-block leading-none">Copy Logs</span>
                            <span className="absolute inset-0 flex items-center justify-center leading-none">
                                {copied ? 'Copied!' : 'Copy Logs'}
                            </span>
                        </button>
                        <div className="h-8 px-2.5 py-0 bg-gray-100 border border-gray-200 rounded-md inline-flex items-center">
                            <span className="text-xs text-muted-foreground font-medium">
                                {events.length} events
                            </span>
                        </div>
                    </div>
                </div>

                <div
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto w-full p-6 space-y-4"
                >
                    {result.status === 'IDLE' ? (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                            <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center">
                                <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                            </div>
                            <div className="space-y-2">
                                <p className="text-base font-medium text-foreground">Ready to Run</p>
                                <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                                    Configure your test parameters and click Run Test to begin
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {events.map((event, index) => (
                                <TimelineEvent
                                    key={index}
                                    event={event}
                                    isLast={index === events.length - 1}
                                    onImageClick={(src, label) => setLightboxImage({ src, label })}
                                />
                            ))}

                            {result.status === 'RUNNING' && (
                                <div className="relative pl-8 flex items-center gap-2 mt-4 ml-1">
                                    <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-md text-gray-500 text-sm">
                                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <span>Waiting for events...</span>
                                    </div>
                                </div>
                            )}

                            <ResultStatus status={result.status} error={result.error} eventCount={events.length} />
                            <div ref={messagesEndRef} />
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

type TestEvent =
    | { type: 'log'; data: { message: string; level: 'info' | 'error' | 'success' }; timestamp: number }
    | { type: 'screenshot'; data: { src: string; label: string }; timestamp: number };

interface TestResult {
    status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
    events: TestEvent[];
    error?: string;
}

interface ResultViewerProps {
    result: TestResult;
}

export default function ResultViewer({ result }: ResultViewerProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    useEffect(() => {
        if (!autoScroll || !scrollContainerRef.current) return;

        const container = scrollContainerRef.current;
        const isNearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < 150;

        if (isNearBottom || result.events.length === 0) {
            // Use requestAnimationFrame for smoother scrolling
            requestAnimationFrame(() => {
                container.scrollTo({
                    top: container.scrollHeight,
                    behavior: 'smooth'
                });
            });
        }
    }, [result.events, autoScroll]);

    const handleScroll = () => {
        if (!scrollContainerRef.current) return;

        const container = scrollContainerRef.current;
        const isNearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < 150;

        // Enable auto-scroll when user scrolls near bottom, disable when scrolling up
        if (isNearBottom && !autoScroll) {
            setAutoScroll(true);
        } else if (!isNearBottom && autoScroll) {
            setAutoScroll(false);
        }
    };

    const scrollToBottom = () => {
        if (!scrollContainerRef.current) return;
        const container = scrollContainerRef.current;
        container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth'
        });
        setAutoScroll(true);
    };

    return (
        <div className="glass-panel h-full max-h-[800px] flex flex-col relative">
            {/* Auto-scroll indicator */}
            {!autoScroll && result.status === 'RUNNING' && (
                <button
                    onClick={scrollToBottom}
                    className="absolute bottom-8 right-8 z-50 px-4 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-md shadow-lg flex items-center gap-2 font-medium text-sm transition-colors"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                    <span>New Activity</span>
                </button>
            )}

            {/* Header */}
            <div className="p-5 border-b border-gray-200 flex items-center justify-between bg-white rounded-t-lg">
                <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-foreground">Test Results</h2>
                    {result.status !== 'IDLE' && (
                        <div className={`status-badge ${result.status === 'PASS' ? 'status-badge-pass' :
                            result.status === 'FAIL' ? 'status-badge-fail' :
                                'status-badge-running'
                            }`}>
                            {result.status === 'PASS' && '✓'}
                            {result.status === 'FAIL' && '✕'}
                            <span>{result.status}</span>
                        </div>
                    )}
                </div>
                <div className="px-2.5 py-1 bg-gray-100 border border-gray-200 rounded-md">
                    <span className="text-xs text-muted-foreground font-medium">
                        {result.events.length} events
                    </span>
                </div>
            </div>

            {/* Content */}
            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-5 space-y-4"
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
                    <div className="space-y-4 relative">
                        {result.events.map((event, index) => (
                            <div key={index} className="relative pl-6 group">
                                {/* Timeline */}
                                {index < result.events.length - 1 && (
                                    <div className="timeline-line" />
                                )}

                                {/* Dot */}
                                <div className={`timeline-dot ${event.type === 'log' && event.data?.level === 'error' ? 'bg-red-500' :
                                    event.type === 'log' && event.data?.level === 'success' ? 'bg-green-500' :
                                        event.type === 'screenshot' ? 'bg-purple-500' :
                                            'bg-blue-500'
                                    }`} />

                                {/* Log Event */}
                                {event.type === 'log' && event.data && (
                                    <div className={`rounded-md p-3 border ${event.data.level === 'error' ? 'bg-red-50 border-red-200' :
                                        event.data.level === 'success' ? 'bg-green-50 border-green-200' :
                                            'bg-blue-50 border-blue-200'
                                        }`}>
                                        <div className="flex items-start justify-between gap-3 mb-2">
                                            <div className="flex items-center gap-2">
                                                {event.data.level === 'error' && (
                                                    <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                )}
                                                {event.data.level === 'success' && (
                                                    <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                )}
                                                {event.data.level === 'info' && (
                                                    <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                )}
                                                <span className={`text-xs font-medium ${event.data.level === 'error' ? 'text-red-700' :
                                                    event.data.level === 'success' ? 'text-green-700' :
                                                        'text-blue-700'
                                                    }`}>
                                                    {event.data.level?.toUpperCase() || 'INFO'}
                                                </span>
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(event.timestamp).toLocaleTimeString([], {
                                                    hour12: false,
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit'
                                                })}
                                            </span>
                                        </div>
                                        <p className={`text-sm leading-relaxed break-words whitespace-pre-wrap ${event.data.level === 'error' ? 'text-red-800' :
                                            event.data.level === 'success' ? 'text-green-800' :
                                                'text-blue-800'
                                            }`}>
                                            {event.data.message || ''}
                                        </p>
                                    </div>
                                )}

                                {/* Screenshot Event */}
                                {event.type === 'screenshot' && event.data && (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                            <span className="font-medium">{event.data.label || 'Screenshot'}</span>
                                        </div>
                                        <div className="relative rounded-md overflow-hidden border border-gray-200 shadow-sm bg-white">
                                            <Image
                                                src={event.data.src}
                                                alt={event.data.label || 'Screenshot'}
                                                width={1280}
                                                height={800}
                                                style={{ width: '100%', height: 'auto' }}
                                                className="rounded-md"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Running Indicator */}
                        {result.status === 'RUNNING' && (
                            <div className="relative pl-6 flex items-center gap-2">
                                <div className="timeline-dot bg-blue-500 animate-pulse" />
                                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md">
                                    <svg className="w-4 h-4 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span className="text-sm text-blue-700 font-medium">Running test...</span>
                                </div>
                            </div>
                        )}

                        {/* Final Result - PASSED */}
                        {result.status === 'PASS' && (
                            <div className="mt-6 p-6 bg-green-50 border border-green-200 rounded-lg">
                                <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                        <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <h3 className="text-lg font-semibold text-green-900">Test Passed</h3>
                                        <p className="text-sm text-green-700 leading-relaxed">
                                            All test steps completed successfully without errors.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Final Result - FAILED */}
                        {result.status === 'FAIL' && (
                            <div className="mt-6 p-6 bg-red-50 border border-red-200 rounded-lg">
                                <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                                        <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <div className="flex-1 space-y-2 overflow-hidden">
                                        <h3 className="text-lg font-semibold text-red-900">Test Failed</h3>
                                        {result.error ? (
                                            <div className="space-y-1">
                                                <p className="text-xs text-red-700 font-medium">Error Details:</p>
                                                <p className="text-sm text-red-800 leading-relaxed bg-red-100 p-3 rounded-md border border-red-200 break-words whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                                                    {result.error}
                                                </p>
                                            </div>
                                        ) : (
                                            <p className="text-sm text-red-700 leading-relaxed">
                                                The test encountered an error during execution. Check the logs above for details.
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
}

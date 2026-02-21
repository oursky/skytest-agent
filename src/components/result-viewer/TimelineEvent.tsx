import Image from 'next/image';
import { formatTime } from '@/utils/dateFormatter';
import { TestEvent } from '@/types';
import { useI18n } from '@/i18n';

interface TimelineEventProps {
    event: TestEvent;
    isLast: boolean;
    onImageClick: (src: string, label: string) => void;
    targetType?: 'browser' | 'android';
}

export default function TimelineEvent({ event, isLast, onImageClick, targetType = 'browser' }: TimelineEventProps) {
    const { t } = useI18n();

    return (
        <div className="relative pl-6 group">
            {/* Timeline */}
            {!isLast && (
                <div className="timeline-line" />
            )}

            {/* Dot */}
            <div className={`timeline-dot ${event.type === 'log' && event.data && 'level' in event.data && event.data.level === 'error' ? 'bg-red-500' :
                event.type === 'log' && event.data && 'level' in event.data && event.data.level === 'success' ? 'bg-green-500' :
                    event.type === 'screenshot' ? 'bg-purple-500' :
                        'bg-blue-500'
                }`} />

            {/* Log Event */}
            {event.type === 'log' && event.data && 'message' in event.data && (
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
                            <span className="text-xs">{targetType === 'android' ? '📱' : '🌐'}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                            {formatTime(event.timestamp)}
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
            {event.type === 'screenshot' && event.data && 'src' in event.data && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="font-medium">{event.data.label || t('timeline.screenshot')}</span>
                        {targetType === 'android' && (
                            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">📱 Android</span>
                        )}
                    </div>
                    <div
                        className={`relative rounded-md overflow-hidden border border-gray-200 shadow-sm bg-white cursor-pointer group ${targetType === 'android' ? 'max-w-[280px]' : ''}`}
                        onClick={() => 'src' in event.data && onImageClick(event.data.src, event.data.label || t('timeline.screenshot'))}
                    >
                        <Image
                            src={event.data.src}
                            alt={event.data.label || t('timeline.screenshot')}
                            width={targetType === 'android' ? 1080 : 1280}
                            height={targetType === 'android' ? 2400 : 800}
                            style={{ width: '100%', height: 'auto' }}
                            className="rounded-md transition-opacity group-hover:opacity-90"
                        />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                            <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-lg">
                                <svg className="w-5 h-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                                </svg>
                                <span className="text-sm font-medium text-gray-700">{t('timeline.clickToEnlarge')}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

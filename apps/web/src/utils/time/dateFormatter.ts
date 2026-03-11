export function formatDateTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

export function formatDateTimeCompact(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

export function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function encodeRFC5987(value: string): string {
    return encodeURIComponent(value).replace(/['()*]/g, (char) => (
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    ));
}

function normalizeFilename(filename: string): string {
    return filename
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/[\\"]/g, '_')
        .replace(/;/g, '_')
        .trim();
}

export function buildContentDisposition(disposition: 'attachment' | 'inline', filename: string): string {
    const normalizedFilename = normalizeFilename(filename) || 'download';
    const asciiFallback = normalizedFilename.replace(/[^\x20-\x7E]/g, '_') || 'download';
    const fallback = asciiFallback.slice(0, 255);
    const encoded = encodeRFC5987(normalizedFilename);

    return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

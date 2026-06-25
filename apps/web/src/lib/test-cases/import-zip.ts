import yauzl from 'yauzl';
import path from 'path';

const MAX_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

export interface ZipTestCaseEntry {
    base: string;
    xlsx: Buffer;
    attachments: Array<{ filename: string; content: Buffer }>;
}

export async function readZipEntries(buffer: Buffer): Promise<Map<string, Buffer>> {
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
            if (err || !zipfile) {
                reject(err ?? new Error('Failed to read zip archive'));
                return;
            }

            const entries = new Map<string, Buffer>();
            let totalBytes = 0;

            zipfile.on('error', reject);
            zipfile.on('end', () => resolve(entries));
            zipfile.on('entry', (entry) => {
                if (/\/$/.test(entry.fileName)) {
                    zipfile.readEntry();
                    return;
                }
                zipfile.openReadStream(entry, (streamErr, stream) => {
                    if (streamErr || !stream) {
                        reject(streamErr ?? new Error('Failed to read zip entry'));
                        return;
                    }
                    const chunks: Buffer[] = [];
                    stream.on('data', (chunk: Buffer) => {
                        totalBytes += chunk.length;
                        if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
                            stream.destroy();
                            reject(new Error('Zip archive exceeds the maximum allowed size'));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    stream.on('error', reject);
                    stream.on('end', () => {
                        entries.set(entry.fileName, Buffer.concat(chunks));
                        zipfile.readEntry();
                    });
                });
            });

            zipfile.readEntry();
        });
    });
}

// Groups a flat set of zip entries into per-test-case bundles by matching each
// `test-cases/{base}.xlsx` workbook with its sibling `test-cases/{base}/files/*`
// attachments, tolerating the leading export folder prefix.
export function extractTestCaseEntries(entries: Map<string, Buffer>): ZipTestCaseEntry[] {
    const byBase = new Map<string, ZipTestCaseEntry>();

    const ensure = (base: string): ZipTestCaseEntry => {
        let entry = byBase.get(base);
        if (!entry) {
            entry = { base, xlsx: Buffer.alloc(0), attachments: [] };
            byBase.set(base, entry);
        }
        return entry;
    };

    for (const [rawPath, content] of entries) {
        const marker = 'test-cases/';
        const markerIndex = rawPath.indexOf(marker);
        if (markerIndex < 0) {
            continue;
        }
        const rest = rawPath.slice(markerIndex + marker.length);

        const workbookMatch = rest.match(/^([^/]+)\.xlsx$/i);
        if (workbookMatch) {
            ensure(workbookMatch[1]).xlsx = content;
            continue;
        }

        const attachmentMatch = rest.match(/^(.+)\/files\/(.+)$/);
        if (attachmentMatch) {
            ensure(attachmentMatch[1]).attachments.push({
                filename: path.basename(attachmentMatch[2]),
                content,
            });
        }
    }

    return [...byBase.values()].filter((entry) => entry.xlsx.length > 0);
}

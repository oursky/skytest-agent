import { randomUUID } from 'node:crypto';
import { objectStore } from '../../src/lib/storage/object-store';

async function main() {
    const key = `smoke/${Date.now()}-${randomUUID()}.txt`;
    const body = Buffer.from(`smoke-${Date.now()}`, 'utf8');

    await objectStore.putObject({
        key,
        body,
        contentType: 'text/plain',
    });

    const stored = await objectStore.getObject(key);
    if (!stored) {
        throw new Error('stored object was not found after putObject');
    }
    if (!stored.body.equals(body)) {
        throw new Error('stored object content mismatch');
    }

    const signedUrl = await objectStore.getSignedDownloadUrl({
        key,
        filename: 'smoke.txt',
        contentType: 'text/plain',
    });
    if (!signedUrl || !signedUrl.startsWith('http')) {
        throw new Error('signed download URL is invalid');
    }

    await objectStore.deleteObject(key);
    const afterDelete = await objectStore.getObject(key);
    if (afterDelete !== null) {
        throw new Error('object still exists after deleteObject');
    }

    console.log(JSON.stringify({ ok: true, key, signedUrl }));
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

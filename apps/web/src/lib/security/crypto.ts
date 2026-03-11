import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

function getSecret(): string {
    const secret = process.env.ENCRYPTION_SECRET;
    if (!secret) {
        throw new Error('ENCRYPTION_SECRET environment variable is required');
    }
    return secret;
}

function deriveKey(salt: Buffer): Buffer {
    return scryptSync(getSecret(), salt, KEY_LENGTH);
}

export function encrypt(text: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const key = deriveKey(salt);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');

    if (parts.length !== 4) {
        throw new Error('Invalid encrypted text format');
    }

    const salt = Buffer.from(parts[0], 'hex');
    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encrypted = parts[3];

    const key = deriveKey(salt);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

export function maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) {
        return '****';
    }
    return apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4);
}

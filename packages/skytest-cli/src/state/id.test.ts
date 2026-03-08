import { describe, expect, it } from 'vitest';
import { generateLocalRunnerId } from './id';

describe('generateLocalRunnerId', () => {
    it('generates a six-character lowercase base36 id', () => {
        const id = generateLocalRunnerId(new Set());
        expect(id).toMatch(/^[a-z0-9]{6}$/);
    });

    it('retries when generated id collides', () => {
        let calls = 0;
        const customRandomBytes = () => {
            calls += 1;
            if (calls === 1) {
                return Buffer.from([0, 0, 0, 0, 0, 0]);
            }
            return Buffer.from([1, 1, 1, 1, 1, 1]);
        };

        const existing = new Set(['aaaaaa']);
        const id = generateLocalRunnerId(existing, customRandomBytes);
        expect(id).toBe('bbbbbb');
    });
});

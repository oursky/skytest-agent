import { describe, expect, it } from 'vitest';
import { validateConfigValue } from '@/lib/test-config/validation';

describe('validateConfigValue', () => {
    it.each(['TIMESTAMP_DATETIME', 'TIMESTAMP_UNIX', 'UUID'])(
        'accepts the RANDOM_STRING generation type %s',
        (value) => {
            expect(validateConfigValue('RANDOM_STRING', value)).toBeNull();
        }
    );

    it.each(['', 'timestamp', 'UUID_V4'])(
        'rejects the invalid RANDOM_STRING generation type %s',
        (value) => {
            expect(validateConfigValue('RANDOM_STRING', value)).toBe(
                'Random string value must be TIMESTAMP_DATETIME, TIMESTAMP_UNIX, or UUID'
            );
        }
    );

    it('does not restrict values for other config types', () => {
        expect(validateConfigValue('VARIABLE', '')).toBeNull();
    });
});

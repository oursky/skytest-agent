import { describe, expect, it } from 'vitest';
import { normalizeConfigName, validateConfigValue } from '@/lib/test-config/validation';

describe('normalizeConfigName', () => {
    it('preserves a digit directly followed by an uppercase letter', () => {
        expect(normalizeConfigName('SAMPLE_VAR_2A')).toBe('SAMPLE_VAR_2A');
    });

    it('splits camelCase words into snake_case', () => {
        expect(normalizeConfigName('sampleVarName')).toBe('SAMPLE_VAR_NAME');
    });

    it('is idempotent for an already-normalized name', () => {
        expect(normalizeConfigName('SAMPLE_VAR_2A')).toBe(
            normalizeConfigName(normalizeConfigName('SAMPLE_VAR_2A'))
        );
    });
});

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

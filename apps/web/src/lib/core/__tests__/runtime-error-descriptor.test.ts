import { describe, expect, it } from 'vitest';
import { describeRuntimeErrorValue } from '@/lib/core/runtime-error-descriptor';

describe('describeRuntimeErrorValue', () => {
    it('describes Error instances with stable summary', () => {
        const descriptor = describeRuntimeErrorValue(new Error('boom'));

        expect(descriptor.summary).toBe('Error: boom');
        expect(descriptor.detail.message).toBe('boom');
        expect(descriptor.detail.name).toBe('Error');
    });

    it('describes event-like objects without [object Event] fallback', () => {
        const descriptor = describeRuntimeErrorValue({
            type: 'error',
            target: { src: 'blob:http://localhost/worker.js' },
        });

        expect(descriptor.summary).toBe('Event(error)');
        expect(descriptor.detail.type).toBe('error');
        expect(descriptor.detail.targetSrc).toBe('blob:http://localhost/worker.js');
    });

    it('describes generic objects with key preview', () => {
        const descriptor = describeRuntimeErrorValue({
            foo: 'bar',
            baz: 1,
        });

        expect(descriptor.summary).toBe('Object(foo,baz)');
        expect(descriptor.detail.keys).toBe('foo,baz');
    });
});

import { describe, expect, it } from 'vitest';
import { resolveRuntimeRootFromSourcePath } from '@/lib/test-cases/source-path-utils';

describe('resolveRuntimeRootFromSourcePath', () => {
    it('returns null when source path is missing', () => {
        expect(resolveRuntimeRootFromSourcePath(undefined)).toBeNull();
        expect(resolveRuntimeRootFromSourcePath(null)).toBeNull();
        expect(resolveRuntimeRootFromSourcePath('')).toBeNull();
    });

    it('returns null when source path does not include .skytest marker', () => {
        expect(resolveRuntimeRootFromSourcePath('/tmp/workspace/tests/CASE-A01.case.yaml')).toBeNull();
    });

    it('returns runtime root when source path includes .skytest marker', () => {
        expect(
            resolveRuntimeRootFromSourcePath('/tmp/sample-workspace/.skytest/tests/scenario-a/CASE-A02.case.yaml')
        ).toBe('/tmp/sample-workspace');
    });
});

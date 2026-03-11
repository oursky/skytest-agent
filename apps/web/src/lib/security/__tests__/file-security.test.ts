import { describe, expect, it } from 'vitest';
import {
    buildProjectConfigObjectKey,
    buildRunArtifactObjectKey,
    buildTestCaseConfigObjectKey,
    buildTestCaseFileObjectKey,
} from '@/lib/security/file-security';

describe('object key generation', () => {
    it('builds deterministic scoped object keys', () => {
        expect(buildTestCaseFileObjectKey('test-case-1', 'steps.json')).toBe(
            'test-cases/test-case-1/files/steps.json'
        );
        expect(buildProjectConfigObjectKey('project-1', 'project.json')).toBe(
            'projects/project-1/configs/project.json'
        );
        expect(buildTestCaseConfigObjectKey('test-case-1', 'config.json')).toBe(
            'test-cases/test-case-1/configs/config.json'
        );
        expect(buildRunArtifactObjectKey('run-1', 'trace.zip')).toBe(
            'test-runs/run-1/artifacts/trace.zip'
        );
    });
});

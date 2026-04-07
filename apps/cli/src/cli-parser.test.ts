import { describe, expect, it } from 'vitest';
import { parseSkytestCliCommand } from './cli-parser';

describe('parseSkytestCliCommand', () => {
    it('parses help with empty args', () => {
        expect(parseSkytestCliCommand([])).toEqual({ kind: 'help' });
    });

    it('parses version command', () => {
        expect(parseSkytestCliCommand(['version'])).toEqual({ kind: 'version' });
    });

    it('parses init command', () => {
        expect(parseSkytestCliCommand(['init'])).toEqual({ kind: 'init' });
    });

    it('rejects unknown init arguments', () => {
        expect(() => parseSkytestCliCommand(['init', '--foo'])).toThrow('Unknown argument(s) for `init`: --foo');
    });

    it('parses pair runner with options', () => {
        expect(parseSkytestCliCommand([
            'pair',
            'runner',
            'token-123',
            '--label',
            'QA Runner',
            '--url',
            'http://127.0.0.1:3000',
            '--no-start',
        ])).toEqual({
            kind: 'pair-runner',
            pairingToken: 'token-123',
            label: 'QA Runner',
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            autoStart: false,
        });
    });

    it('rejects legacy --control-plane-url option', () => {
        expect(() => parseSkytestCliCommand([
            'pair',
            'runner',
            'token-123',
            '--control-plane-url',
            'http://127.0.0.1:3000',
        ])).toThrow('Unknown option for `pair runner`: --control-plane-url');
    });

    it('parses get runners with json format', () => {
        expect(parseSkytestCliCommand(['get', 'runners', '--json'])).toEqual({
            kind: 'get-runners',
            format: 'json',
        });
    });

    it('parses sync runners with text format', () => {
        expect(parseSkytestCliCommand(['sync', 'runners', '--format', 'text'])).toEqual({
            kind: 'sync-runners',
            format: 'text',
        });
    });

    it('parses sync runners with default text format', () => {
        expect(parseSkytestCliCommand(['sync', 'runners'])).toEqual({
            kind: 'sync-runners',
            format: 'text',
        });
    });

    it('parses sync runners with json format', () => {
        expect(parseSkytestCliCommand(['sync', 'runners', '--json'])).toEqual({
            kind: 'sync-runners',
            format: 'json',
        });
    });

    it('parses start runner with repair token option', () => {
        expect(parseSkytestCliCommand(['start', 'runner', 'abc123', '--repair-token', 'st_pair_token'])).toEqual({
            kind: 'start-runner',
            runnerId: 'abc123',
            repairPairingToken: 'st_pair_token',
        });
    });

    it('rejects start runner with missing repair token value', () => {
        expect(() => parseSkytestCliCommand(['start', 'runner', 'abc123', '--repair-token']))
            .toThrow('Missing value for `--repair-token`.');
    });

    it('rejects unknown start runner option', () => {
        expect(() => parseSkytestCliCommand(['start', 'runner', 'abc123', '--foo']))
            .toThrow('Unknown option for `start runner`: --foo');
    });

    it('parses logs runner with follow and tail', () => {
        expect(parseSkytestCliCommand(['logs', 'runner', 'abc123', '--follow', '--tail', '20'])).toEqual({
            kind: 'logs-runner',
            runnerId: 'abc123',
            follow: true,
            tail: 20,
        });
    });

    it('parses reset force flag', () => {
        expect(parseSkytestCliCommand(['reset', '--force'])).toEqual({
            kind: 'reset',
            force: true,
        });
    });

    it('parses run test-case with explicit options', () => {
        expect(parseSkytestCliCommand([
            'run',
            'test-case',
            'CASE-A02',
            '--project-id',
            'project-123',
            '--url',
            'http://127.0.0.1:3000',
            '--api-key',
            'sk_test_abc',
            '--sync-root',
            '/tmp/sample-workspace',
            '--timeout-ms',
            '120000',
            '--json',
        ])).toEqual({
            kind: 'run-test-case',
            displayId: 'CASE-A02',
            projectId: 'project-123',
            controlPlaneBaseUrl: 'http://127.0.0.1:3000',
            authToken: 'sk_test_abc',
            syncRoot: '/tmp/sample-workspace',
            wait: true,
            timeoutMs: 120000,
            format: 'json',
        });
    });

    it('parses run test-case with --no-wait', () => {
        expect(parseSkytestCliCommand([
            'run',
            'test-case',
            'CASE-A03',
            '--project-id',
            'project-123',
            '--no-wait',
        ])).toEqual({
            kind: 'run-test-case',
            displayId: 'CASE-A03',
            projectId: 'project-123',
            controlPlaneBaseUrl: undefined,
            authToken: undefined,
            syncBeforeRun: undefined,
            syncRoot: undefined,
            wait: false,
            timeoutMs: 600000,
            format: 'text',
        });
    });

    it('parses run test-case with --no-sync', () => {
        expect(parseSkytestCliCommand([
            'run',
            'test-case',
            'CASE-A03',
            '--project-id',
            'project-123',
            '--no-sync',
        ])).toEqual({
            kind: 'run-test-case',
            displayId: 'CASE-A03',
            projectId: 'project-123',
            controlPlaneBaseUrl: undefined,
            authToken: undefined,
            syncBeforeRun: false,
            syncRoot: undefined,
            wait: true,
            timeoutMs: 600000,
            format: 'text',
        });
    });

    it('parses run project with display-id filters', () => {
        expect(parseSkytestCliCommand([
            'run',
            'project',
            'project-123',
            '--display-id',
            'CASE-A02',
            '--display-id',
            'CASE-B01',
            '--token',
            'sk_test_abc',
            '--format',
            'json',
        ])).toEqual({
            kind: 'run-project',
            projectId: 'project-123',
            controlPlaneBaseUrl: undefined,
            authToken: 'sk_test_abc',
            syncBeforeRun: undefined,
            syncRoot: undefined,
            displayIds: ['CASE-A02', 'CASE-B01'],
            concurrency: 1,
            wait: true,
            timeoutMs: 600000,
            format: 'json',
        });
    });

    it('parses run project with --no-sync and --sync-root', () => {
        expect(parseSkytestCliCommand([
            'run',
            'project',
            'project-123',
            '--no-sync',
            '--sync-root',
            '/tmp/sample-workspace',
        ])).toEqual({
            kind: 'run-project',
            projectId: 'project-123',
            controlPlaneBaseUrl: undefined,
            authToken: undefined,
            syncBeforeRun: false,
            syncRoot: '/tmp/sample-workspace',
            displayIds: [],
            concurrency: 1,
            wait: true,
            timeoutMs: 600000,
            format: 'text',
        });
    });

    it('parses run project with --concurrency', () => {
        expect(parseSkytestCliCommand([
            'run',
            'project',
            'project-123',
            '--concurrency',
            '3',
        ])).toEqual({
            kind: 'run-project',
            projectId: 'project-123',
            controlPlaneBaseUrl: undefined,
            authToken: undefined,
            syncBeforeRun: undefined,
            syncRoot: undefined,
            displayIds: [],
            concurrency: 3,
            wait: true,
            timeoutMs: 600000,
            format: 'text',
        });
    });

    it('rejects run test-case without project-id', () => {
        expect(() => parseSkytestCliCommand([
            'run',
            'test-case',
            'CASE-A02',
        ])).toThrow('`--project-id` is required for `run` commands.');
    });

    it('rejects run project with missing display-id value', () => {
        expect(() => parseSkytestCliCommand([
            'run',
            'project',
            'project-123',
            '--display-id',
        ])).toThrow('Missing value for `--display-id`.');
    });

    it('rejects run test-case without display id', () => {
        expect(() => parseSkytestCliCommand([
            'run',
            'test-case',
            '--project-id',
            'project-123',
        ])).toThrow('Usage: skytest run test-case <display-id> --project-id <project-id> [options]');
    });

    it('rejects run project without project id', () => {
        expect(() => parseSkytestCliCommand([
            'run',
            'project',
        ])).toThrow('Usage: skytest run project <project-id> [options]');
    });

    it('rejects run command with unknown option', () => {
        expect(() => parseSkytestCliCommand([
            'run',
            'test-case',
            'CASE-A02',
            '--project-id',
            'project-123',
            '--bogus',
        ])).toThrow('Unknown option for `run`: --bogus');
    });

    it('rejects run project with invalid format value', () => {
        expect(() => parseSkytestCliCommand([
            'run',
            'project',
            'project-123',
            '--format',
            'yaml',
        ])).toThrow('Expected `json` or `text` after `--format`.');
    });

    it('rejects run project with invalid concurrency', () => {
        expect(() => parseSkytestCliCommand([
            'run',
            'project',
            'project-123',
            '--concurrency',
            '0',
        ])).toThrow('`--concurrency` must be a positive integer.');
    });

    it('rejects missing sync-root value', () => {
        expect(() => parseSkytestCliCommand([
            'run',
            'test-case',
            'CASE-A02',
            '--project-id',
            'project-123',
            '--sync-root',
        ])).toThrow('Missing value for `--sync-root`.');
    });

    it('throws on unknown command', () => {
        expect(() => parseSkytestCliCommand(['unknown', 'command'])).toThrow('Unknown command');
    });
});

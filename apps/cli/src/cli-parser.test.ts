import { describe, expect, it } from 'vitest';
import { parseSkytestCliCommand } from './cli-parser';

describe('parseSkytestCliCommand', () => {
    it('parses help with empty args', () => {
        expect(parseSkytestCliCommand([])).toEqual({ kind: 'help' });
    });

    it('parses version command', () => {
        expect(parseSkytestCliCommand(['version'])).toEqual({ kind: 'version' });
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

    it('throws on unknown command', () => {
        expect(() => parseSkytestCliCommand(['unknown', 'command'])).toThrow('Unknown command');
    });
});

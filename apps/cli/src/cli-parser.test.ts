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

    it('parses local setup command', () => {
        expect(parseSkytestCliCommand(['local', 'setup'])).toEqual({
            kind: 'local',
            action: 'setup',
        });
    });

    it('parses local up command', () => {
        expect(parseSkytestCliCommand(['local', 'up'])).toEqual({
            kind: 'local',
            action: 'up',
        });
    });

    it('parses local up command with detach flag', () => {
        expect(parseSkytestCliCommand(['local', 'up', '-d'])).toEqual({
            kind: 'local',
            action: 'up',
            detach: true,
        });
    });

    it('parses local up command with detach timeout', () => {
        expect(parseSkytestCliCommand(['local', 'up', '--detach', '--timeout-ms', '120000'])).toEqual({
            kind: 'local',
            action: 'up',
            detach: true,
            timeoutMs: 120000,
        });
    });

    it('parses local down command', () => {
        expect(parseSkytestCliCommand(['local', 'down'])).toEqual({
            kind: 'local',
            action: 'down',
        });
    });

    it('parses local status command', () => {
        expect(parseSkytestCliCommand(['local', 'status'])).toEqual({
            kind: 'local',
            action: 'status',
        });
    });

    it('parses local update command', () => {
        expect(parseSkytestCliCommand(['local', 'update'])).toEqual({
            kind: 'local',
            action: 'update',
        });
    });

    it('rejects unknown local subcommand', () => {
        expect(() => parseSkytestCliCommand(['local', 'restart'])).toThrow('Unknown local subcommand: restart');
    });

    it('rejects local subcommand with extra args', () => {
        expect(() => parseSkytestCliCommand(['local', 'status', '--json']))
            .toThrow('Unknown argument(s) for `local status`: --json');
    });

    it('rejects invalid local up timeout', () => {
        expect(() => parseSkytestCliCommand(['local', 'up', '--timeout-ms', 'abc']))
            .toThrow('`--timeout-ms` must be a positive integer.');
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

    it('throws on unknown command', () => {
        expect(() => parseSkytestCliCommand(['unknown', 'command'])).toThrow('Unknown command');
    });
});

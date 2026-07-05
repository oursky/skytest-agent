import { describe, it, expect } from 'vitest';
import { createMemberAbortController } from '@/lib/runtime/member-abort-controller';

describe('createMemberAbortController', () => {
    it('aborting the member does NOT abort the session (isolation)', () => {
        const session = new AbortController();
        const { controller: member } = createMemberAbortController(session.signal);

        member.abort();

        expect(member.signal.aborted).toBe(true);
        expect(session.signal.aborted).toBe(false);
    });

    it('does not cross-cancel sibling members when one settles', () => {
        const session = new AbortController();
        const a = createMemberAbortController(session.signal);
        const b = createMemberAbortController(session.signal);

        // Member A finishes/fails and its watcher aborts A.
        a.controller.abort();

        expect(a.controller.signal.aborted).toBe(true);
        expect(session.signal.aborted).toBe(false);
        expect(b.controller.signal.aborted).toBe(false);
    });

    it('aborting the session aborts the member (one-way propagation)', () => {
        const session = new AbortController();
        const { controller: member } = createMemberAbortController(session.signal);

        session.abort();

        expect(member.signal.aborted).toBe(true);
    });

    it('aborts immediately when the session is already aborted', () => {
        const session = new AbortController();
        session.abort();

        const { controller: member } = createMemberAbortController(session.signal);

        expect(member.signal.aborted).toBe(true);
    });

    it('does not propagate a session abort after dispose', () => {
        const session = new AbortController();
        const { controller: member, dispose } = createMemberAbortController(session.signal);

        dispose();
        session.abort();

        expect(member.signal.aborted).toBe(false);
    });
});

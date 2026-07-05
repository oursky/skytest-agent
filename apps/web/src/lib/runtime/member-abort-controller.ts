/**
 * Isolates a session member's aborts from its siblings.
 *
 * A run session (login prefixes + test cases) drives every member with one shared
 * AbortController. Each member also runs a status watcher that aborts on the member going
 * inactive — which happens the instant the member simply finishes or fails. If that abort
 * hit the shared controller, a settled member would cancel every later member, so a failing
 * case in a "Continue running remaining cases" group would still take the rest down with it.
 *
 * The child returned here aborts when the session aborts (one-way: a real session cancel
 * still stops the member), but its own abort never touches the session controller. Call
 * dispose() once the member settles to detach the parent listener.
 */
export function createMemberAbortController(sessionSignal: AbortSignal): {
    controller: AbortController;
    dispose: () => void;
} {
    const controller = new AbortController();
    const onSessionAbort = () => controller.abort();
    if (sessionSignal.aborted) {
        controller.abort();
    } else {
        sessionSignal.addEventListener('abort', onSessionAbort, { once: true });
    }
    return {
        controller,
        dispose: () => sessionSignal.removeEventListener('abort', onSessionAbort),
    };
}

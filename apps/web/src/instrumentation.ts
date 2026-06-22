export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') {
        return;
    }

    // The API process is control-plane only. No host-local runner bootstrap happens here.
    const { registerSlackSubscriber } = await import('@/lib/integrations/slack/subscriber');
    registerSlackSubscriber();
    const { registerRunSessionRollupSubscriber } = await import('@/lib/runtime/run-session-service');
    registerRunSessionRollupSubscriber();
}

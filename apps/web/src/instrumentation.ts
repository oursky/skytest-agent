export async function register() {
    // The API process is control-plane only. No host-local runner bootstrap happens here.
    const { registerSlackSubscriber } = await import('@/lib/integrations/slack/subscriber');
    registerSlackSubscriber();
}

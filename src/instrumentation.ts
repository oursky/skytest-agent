export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { queue } = await import('@/lib/queue');
        await queue.startup();

        const { androidDeviceManager } = await import('@/lib/android-device-manager');
        await androidDeviceManager.initialize();
    }
}

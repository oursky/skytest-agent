export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { queue } = await import('@/lib/runtime/queue');
        await queue.startup();

        const { androidDeviceManager } = await import('@/lib/android/device-manager');
        await androidDeviceManager.initialize();
    }
}

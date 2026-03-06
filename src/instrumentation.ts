export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { androidDeviceManager } = await import('@/lib/android/device-manager');
        await androidDeviceManager.initialize();
    }
}

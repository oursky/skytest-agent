export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { queue } = await import('@/lib/queue');
        await queue.startup();

        const { config } = await import('@/config/app');
        if (config.features.androidEmulator) {
            const { EmulatorPool } = await import('@/lib/emulator-pool');
            const pool = EmulatorPool.getInstance();
            await pool.initialize();
        }
    }
}

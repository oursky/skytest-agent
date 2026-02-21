export interface AndroidDockerProfilePreset {
    name: string;
    displayName: string;
    dockerImage: string;
    apiLevel: number;
    screenSize: string;
}

export const androidDockerProfilePresets: readonly AndroidDockerProfilePreset[] = [
    {
        name: 'android_14_phone',
        displayName: 'Android 14 Phone',
        dockerImage: 'budtmo/docker-android:emulator_14.0',
        apiLevel: 34,
        screenSize: '1080x2340',
    },
    {
        name: 'android_13_phone',
        displayName: 'Android 13 Phone',
        dockerImage: 'budtmo/docker-android:emulator_13.0',
        apiLevel: 33,
        screenSize: '1080x1920',
    },
    {
        name: 'android_12_phone',
        displayName: 'Android 12 Phone',
        dockerImage: 'budtmo/docker-android:emulator_12.0',
        apiLevel: 32,
        screenSize: '1080x1920',
    },
];

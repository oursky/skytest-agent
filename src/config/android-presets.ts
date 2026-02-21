export interface AndroidDockerProfilePreset {
    name: string;
    displayName: string;
    dockerImage: string;
    apiLevel: number;
    screenSize: string;
}

export const androidDockerProfilePresets: readonly AndroidDockerProfilePreset[] = [
    {
        name: 'android_15_phone',
        displayName: 'Android 15 Phone',
        dockerImage: 'budtmo/docker-android:emulator_35.0',
        apiLevel: 35,
        screenSize: '1080x2400',
    },
    {
        name: 'android_14_phone',
        displayName: 'Android 14 Phone',
        dockerImage: 'budtmo/docker-android:emulator_34.0',
        apiLevel: 34,
        screenSize: '1080x2340',
    },
    {
        name: 'android_13_phone',
        displayName: 'Android 13 Phone',
        dockerImage: 'budtmo/docker-android:emulator_33.0',
        apiLevel: 33,
        screenSize: '1080x1920',
    },
];

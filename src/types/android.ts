// Minimal interfaces representing the Android runtime contract used by test-runner.

export interface AndroidAgent {
    aiAct(instruction: string): Promise<void>;
    aiAssert(assertion: string): Promise<void>;
    aiQuery(query: string): Promise<unknown>;
    launch(packageOrActivity: string): Promise<void>;
    setAIActContext(context: string): void;
}

export interface AndroidDevice {
    deviceId: string;
    shell(command: string): Promise<string>;
}

// Minimal interfaces representing the Android runtime contract used by test-runner.

export interface AndroidAgent {
    aiAct(instruction: string): Promise<void>;
    aiAssert(assertion: string): Promise<void>;
    aiWaitFor(assertion: string, options?: { timeoutMs?: number; checkIntervalMs?: number }): Promise<void>;
    aiQuery(query: string): Promise<unknown>;
    launch(packageOrActivity: string): Promise<void>;
    setAIActContext(context: string): void;
    onTaskStartTip?: (tip: string) => void | Promise<void>;
}

export interface AndroidDevice {
    deviceId: string;
    shell(command: string): Promise<string>;
    screenshotBase64?: () => Promise<string>;
}

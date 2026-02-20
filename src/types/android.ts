// Minimal interfaces representing the @midscene/android API.
// Will be replaced with proper imports from @midscene/android in Phase 2.

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

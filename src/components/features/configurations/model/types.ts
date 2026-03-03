import type { BrowserConfig, TargetConfig } from '@/types';

export interface BrowserEntry {
    id: string;
    config: BrowserConfig | TargetConfig;
}

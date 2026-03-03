import type { ConfigType } from '@/types';

export interface ProjectConfigEditState {
    id?: string;
    name: string;
    value: string;
    type: ConfigType;
    masked: boolean;
    group: string;
}

export interface ProjectConfigFileUploadDraft {
    name: string;
    group: string;
    file: File | null;
}

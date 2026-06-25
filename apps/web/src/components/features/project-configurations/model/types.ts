import type { ConfigType } from '@/types';

export interface ProjectConfigEditState {
    id?: string;
    name: string;
    value: string;
    type: ConfigType;
    masked: boolean;
}

export interface ProjectConfigFileUploadDraft {
    name: string;
    file: File | null;
}

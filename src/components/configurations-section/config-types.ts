import type { ConfigType } from '@/types';

export interface EditState {
    id?: string;
    name: string;
    value: string;
    type: ConfigType;
    masked: boolean;
    group: string;
}

export interface FileUploadDraft {
    name: string;
    group: string;
    file: File | null;
}

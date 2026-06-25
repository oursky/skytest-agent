import type { ConfigType } from '@/types';

export interface EditState {
    id?: string;
    name: string;
    value: string;
    type: ConfigType;
    masked: boolean;
}

export interface FileUploadDraft {
    name: string;
    file: File | null;
}

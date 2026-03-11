export interface ApiKeyInfo {
    id: string;
    name: string;
    prefix: string;
    lastUsedAt: string | null;
    createdAt: string;
}

export interface GeneratedApiKey extends ApiKeyInfo {
    key: string;
}

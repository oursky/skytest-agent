export interface TeamOption {
    id: string;
    name: string;
    role: 'OWNER' | 'MEMBER';
    createdAt: string;
    updatedAt: string;
}

export interface CurrentTeam {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

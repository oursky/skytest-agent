import { useCallback, useEffect, useState } from 'react';

export interface OrganizationOption {
    id: string;
    name: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    createdAt: string;
    updatedAt: string;
}

export function useOrganizations(getAccessToken?: () => Promise<string | null>) {
    const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchOrganizations = useCallback(async () => {
        try {
            setLoading(true);
            const headers: HeadersInit = {};
            if (getAccessToken) {
                const token = await getAccessToken();
                if (token) {
                    headers.Authorization = `Bearer ${token}`;
                }
            }

            const response = await fetch('/api/organizations', { headers });
            if (!response.ok) {
                throw new Error('Failed to fetch organizations');
            }

            const data = await response.json() as OrganizationOption[];
            setOrganizations(data);
            setError(null);
        } catch (err) {
            console.error('Error fetching organizations:', err);
            setError('Failed to load organizations');
        } finally {
            setLoading(false);
        }
    }, [getAccessToken]);

    useEffect(() => {
        void fetchOrganizations();
    }, [fetchOrganizations]);

    return {
        organizations,
        loading,
        error,
        refresh: fetchOrganizations,
        setOrganizations,
    };
}

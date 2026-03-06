import { useCallback, useEffect, useState } from 'react';

export interface CurrentOrganization {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

const CURRENT_ORG_EVENT = 'skytest:current-team-changed';

export function dispatchCurrentOrganizationChanged(organizationId: string | null) {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new CustomEvent(CURRENT_ORG_EVENT, {
        detail: { organizationId }
    }));
}

export function useCurrentOrganization(
    getAccessToken?: () => Promise<string | null>,
    enabled = true
) {
    const [currentOrganization, setCurrentOrganization] = useState<CurrentOrganization | null>(null);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<string | null>(null);

    const fetchCurrentOrganization = useCallback(async () => {
        if (!enabled) {
            setLoading(false);
            setCurrentOrganization(null);
            return;
        }

        try {
            setLoading(true);
            const headers: HeadersInit = {};
            if (getAccessToken) {
                const token = await getAccessToken();
                if (token) {
                    headers.Authorization = `Bearer ${token}`;
                }
            }

            const response = await fetch('/api/teams/current', { headers });
            if (!response.ok) {
                throw new Error('Failed to fetch current organization');
            }

            const data = await response.json() as CurrentOrganization | { organization: null };
            if ('organization' in data) {
                setCurrentOrganization(null);
            } else {
                setCurrentOrganization(data);
            }
            setError(null);
        } catch (err) {
            console.error('Error fetching current organization:', err);
            setCurrentOrganization(null);
            setError('Failed to load current organization');
        } finally {
            setLoading(false);
        }
    }, [enabled, getAccessToken]);

    const persistCurrentOrganization = useCallback(async (organizationId: string) => {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };

        if (getAccessToken) {
            const token = await getAccessToken();
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
        }

        const response = await fetch('/api/teams/current', {
            method: 'POST',
            headers,
            body: JSON.stringify({ organizationId }),
        });

        if (!response.ok) {
            throw new Error('Failed to persist current organization');
        }

        const data = await response.json() as CurrentOrganization;
        setCurrentOrganization(data);
        setError(null);
        dispatchCurrentOrganizationChanged(data.id);
        return data;
    }, [getAccessToken]);

    useEffect(() => {
        void fetchCurrentOrganization();
    }, [fetchCurrentOrganization]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleCurrentOrganizationChange = () => {
            void fetchCurrentOrganization();
        };

        window.addEventListener(CURRENT_ORG_EVENT, handleCurrentOrganizationChange);
        return () => {
            window.removeEventListener(CURRENT_ORG_EVENT, handleCurrentOrganizationChange);
        };
    }, [fetchCurrentOrganization]);

    return {
        currentOrganization,
        loading,
        error,
        refresh: fetchCurrentOrganization,
        setCurrentOrganization: persistCurrentOrganization,
    };
}

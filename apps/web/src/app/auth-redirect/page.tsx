"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth-provider";
import { createAuthgearProxyFetch } from "../authgear-proxy-fetch";
import { useI18n } from "@/i18n";

export default function AuthRedirect() {
    const router = useRouter();
    const { authgearConfig, refreshUser } = useAuth();
    const { t } = useI18n();
    const hasAuthgearConfig = Boolean(
        authgearConfig.clientId.trim()
        && authgearConfig.endpoint.trim()
        && authgearConfig.redirectUri.trim()
    );

    useEffect(() => {
        const finishAuth = async () => {
            try {
                const authgearModule = await import("@authgear/web");
                const authgear = authgearModule.default;
                if (!hasAuthgearConfig) {
                    router.push('/');
                    return;
                }

                const proxyFetch = createAuthgearProxyFetch(authgearConfig.endpoint);

                try {
                    await authgear.configure({
                        clientID: authgearConfig.clientId,
                        endpoint: authgearConfig.endpoint,
                        fetch: proxyFetch,
                    });
                } catch {
                    // ignore
                }

                await authgear.finishAuthentication();
                await refreshUser();
                const redirectTo = typeof window !== 'undefined'
                    ? window.sessionStorage.getItem('skytest.postLoginRedirect')
                    : null;
                if (typeof window !== 'undefined') {
                    window.sessionStorage.removeItem('skytest.postLoginRedirect');
                }
                if (redirectTo) {
                    router.push(redirectTo);
                    return;
                }

                const accessToken = authgear.accessToken;
                if (!accessToken) {
                    router.push('/projects');
                    return;
                }

                const teamsResponse = await fetch('/api/teams', {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                });

                if (!teamsResponse.ok) {
                    router.push('/projects');
                    return;
                }

                const teams = await teamsResponse.json() as Array<{ id: string }>;
                router.push(teams.length > 0 ? '/projects' : '/welcome');
            } catch (error) {
                console.error("Authentication failed", error);
                if (typeof window !== 'undefined') {
                    window.sessionStorage.removeItem('skytest.postLoginRedirect');
                }
                router.push("/");
            }
        };

        finishAuth();
    }, [authgearConfig.clientId, authgearConfig.endpoint, hasAuthgearConfig, refreshUser, router]);

    return (
        <div className="flex min-h-screen items-center justify-center">
            <p className="text-lg">{t('auth.finishing')}</p>
        </div>
    );
}

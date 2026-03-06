"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth-provider";
import { createAuthgearProxyFetch } from "../authgear-proxy-fetch";
import { useI18n } from "@/i18n";

export default function AuthRedirect() {
    const router = useRouter();
    const { refreshUser } = useAuth();
    const { t } = useI18n();

    useEffect(() => {
        const finishAuth = async () => {
            try {
                const authgearModule = await import("@authgear/web");
                const authgear = authgearModule.default;

                const endpoint = process.env.NEXT_PUBLIC_AUTHGEAR_ENDPOINT || "";
                const clientID = process.env.NEXT_PUBLIC_AUTHGEAR_CLIENT_ID || "";

                const proxyFetch = createAuthgearProxyFetch(endpoint);

                try {
                    await authgear.configure({
                        clientID,
                        endpoint,
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

                const organizationsResponse = await fetch('/api/teams', {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                });

                if (!organizationsResponse.ok) {
                    router.push('/projects');
                    return;
                }

                const organizations = await organizationsResponse.json() as Array<{ id: string }>;
                router.push(organizations.length > 0 ? '/projects' : '/welcome');
            } catch (error) {
                console.error("Authentication failed", error);
                if (typeof window !== 'undefined') {
                    window.sessionStorage.removeItem('skytest.postLoginRedirect');
                }
                router.push("/");
            }
        };

        finishAuth();
    }, [router, refreshUser]);

    return (
        <div className="flex min-h-screen items-center justify-center">
            <p className="text-lg">{t('auth.finishing')}</p>
        </div>
    );
}

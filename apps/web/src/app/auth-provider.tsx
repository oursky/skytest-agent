"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    useRef,
} from "react";
import type { UserInfo } from "@authgear/web";
import { createAuthgearProxyFetch } from "./authgear-proxy-fetch";
import type { AuthgearRuntimeConfig } from "@/types";

interface AuthContextType {
    authgearConfig: AuthgearRuntimeConfig;
    isLoggedIn: boolean;
    isLoading: boolean;
    user: UserInfo | null;
    login: (options?: { redirectTo?: string }) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    getAccessToken: () => Promise<string | null>;
    openSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

type AuthgearModule = typeof import("@authgear/web");

export const AuthProvider = ({
    children,
    authgearConfig,
}: {
    children: React.ReactNode;
    authgearConfig: AuthgearRuntimeConfig;
}) => {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [user, setUser] = useState<UserInfo | null>(null);
    const hasAuthgearConfig = Boolean(
        authgearConfig.clientId.trim()
        && authgearConfig.endpoint.trim()
        && authgearConfig.redirectUri.trim()
    );

    const authgearModulePromiseRef = useRef<Promise<AuthgearModule> | null>(null);

    const ensureAuthgearConfigured = useCallback(async (): Promise<AuthgearModule> => {
        if (authgearModulePromiseRef.current) {
            return authgearModulePromiseRef.current;
        }

        authgearModulePromiseRef.current = (async () => {
            const authgearModule = await import("@authgear/web");
            const authgear = authgearModule.default;
            if (!hasAuthgearConfig) {
                return authgearModule;
            }

            try {
                const proxyFetch = createAuthgearProxyFetch(authgearConfig.endpoint);

                await authgear.configure({
                    clientID: authgearConfig.clientId,
                    endpoint: authgearConfig.endpoint,
                    fetch: proxyFetch,
                });
            } catch (error) {
                console.warn("Authgear configure skipped/failed", error);
            }

            return authgearModule;
        })();

        return authgearModulePromiseRef.current;
    }, [authgearConfig.clientId, authgearConfig.endpoint, hasAuthgearConfig]);

    const initAuthgear = useCallback(async () => {
        try {
            const authgearModule = await ensureAuthgearConfigured();
            const authgear = authgearModule.default;

            const sessionState = authgear.sessionState;
            if (sessionState === "AUTHENTICATED") {
                setIsLoggedIn(true);
                const userInfo = await authgear.fetchUserInfo();
                setUser(userInfo);
            } else {
                setIsLoggedIn(false);
                setUser(null);
            }
        } catch (error) {
            console.error("Failed to initialize Authgear", error);
        } finally {
            setIsLoading(false);
        }
    }, [ensureAuthgearConfigured]);

    useEffect(() => {
        initAuthgear();
    }, [initAuthgear]);

    const login = async (options?: { redirectTo?: string }) => {
        const authgearModule = await ensureAuthgearConfigured();
        const authgear = authgearModule.default;

        if (typeof window !== 'undefined') {
            const redirectTo = options?.redirectTo?.trim();
            if (redirectTo) {
                window.sessionStorage.setItem('skytest.postLoginRedirect', redirectTo);
            } else {
                window.sessionStorage.removeItem('skytest.postLoginRedirect');
            }
        }

        await authgear.startAuthentication({
            redirectURI: authgearConfig.redirectUri,
            prompt: authgearModule.PromptOption.Login,
        });
    };

    const logout = async () => {
        const authgearModule = await ensureAuthgearConfigured();
        const authgear = authgearModule.default;
        await authgear.logout({
            redirectURI: window.location.origin,
        });
        setIsLoggedIn(false);
        setUser(null);
    };

    const getAccessToken = async () => {
        const authgearModule = await ensureAuthgearConfigured();
        await authgearModule.default.refreshAccessTokenIfNeeded();
        return authgearModule.default.accessToken || null;
    };

    const openSettings = async () => {
        const authgearModule = await ensureAuthgearConfigured();
        await authgearModule.default.open(authgearModule.Page.Settings, {
            openInSameTab: false,
        });
    };

    return (
        <AuthContext.Provider
            value={{
                authgearConfig,
                isLoggedIn,
                isLoading,
                user,
                login,
                logout,
                refreshUser: initAuthgear,
                getAccessToken,
                openSettings,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};

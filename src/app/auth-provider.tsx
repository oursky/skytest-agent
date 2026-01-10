"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
} from "react";
import type { UserInfo } from "@authgear/web";

interface AuthContextType {
    isLoggedIn: boolean;
    isLoading: boolean;
    user: UserInfo | null;
    login: () => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    getAccessToken: () => Promise<string | null>;
    openSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [user, setUser] = useState<UserInfo | null>(null);

    const initAuthgear = useCallback(async () => {
        try {
            const authgear = (await import("@authgear/web")).default;
            await authgear.configure({
                clientID: process.env.NEXT_PUBLIC_AUTHGEAR_CLIENT_ID || "",
                endpoint: process.env.NEXT_PUBLIC_AUTHGEAR_ENDPOINT || "",
            });

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
    }, []);

    useEffect(() => {
        initAuthgear();
    }, [initAuthgear]);

    const login = async () => {
        const authgear = (await import("@authgear/web")).default;
        await authgear.startAuthentication({
            redirectURI: process.env.NEXT_PUBLIC_AUTHGEAR_REDIRECT_URI || "",
            prompt: "login" as any,
            scope: ["openid", "offline_access", "https://authgear.com/scopes/full-userinfo"],
        });
    };

    const logout = async () => {
        const authgear = (await import("@authgear/web")).default;
        await authgear.logout({
            redirectURI: window.location.origin,
        });
        setIsLoggedIn(false);
        setUser(null);
    };

    const getAccessToken = async () => {
        const authgear = (await import("@authgear/web")).default;
        return authgear.accessToken || null;
    };

    const openSettings = async () => {
        const authgear = (await import("@authgear/web")).default;
        const { Page } = await import("@authgear/web");
        await authgear.open(Page.Settings, {
            redirectURI: window.location.href,
        });
    };

    return (
        <AuthContext.Provider value={{ isLoggedIn, isLoading, user, login, logout, refreshUser: initAuthgear, getAccessToken, openSettings }}>
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

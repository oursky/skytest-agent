"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth-provider";

export default function AuthRedirect() {
    const router = useRouter();
    const { refreshUser } = useAuth();

    useEffect(() => {
        const finishAuth = async () => {
            try {
                const authgear = (await import("@authgear/web")).default;
                try {
                    await authgear.configure({
                        clientID: process.env.NEXT_PUBLIC_AUTHGEAR_CLIENT_ID || "",
                        endpoint: process.env.NEXT_PUBLIC_AUTHGEAR_ENDPOINT || "",
                    });
                } catch (e) {
                }
                await authgear.finishAuthentication();
                await refreshUser();
                router.push("/");
            } catch (error) {
                console.error("Authentication failed", error);
                router.push("/");
            }
        };

        finishAuth();
    }, [router, refreshUser]);

    return (
        <div className="flex min-h-screen items-center justify-center">
            <p className="text-lg">Finishing authentication...</p>
        </div>
    );
}

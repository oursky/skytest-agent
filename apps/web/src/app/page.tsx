'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';
import { CenteredLoading } from '@/components/shared';

export default function Home() {
  const { login, isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const loginTriggeredRef = useRef(false);

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      router.push('/projects');
    }
  }, [isLoggedIn, isLoading, router]);

  useEffect(() => {
    if (isLoading || isLoggedIn || loginTriggeredRef.current) {
      return;
    }

    loginTriggeredRef.current = true;
    void login();
  }, [isLoading, isLoggedIn, login]);

  return <CenteredLoading className="min-h-screen" />;
}

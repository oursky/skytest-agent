'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TestForm from './components/TestForm';
import ResultViewer from './components/ResultViewer';

interface TestData {
  url: string;
  username?: string;
  password?: string;
  prompt: string;
}

type TestEvent =
  | { type: 'log'; data: { message: string; level: 'info' | 'error' | 'success' }; timestamp: number }
  | { type: 'screenshot'; data: { src: string; label: string }; timestamp: number };

interface TestResult {
  status: 'IDLE' | 'RUNNING' | 'PASS' | 'FAIL';
  events: TestEvent[];
  error?: string;
}

import { useAuth } from './auth-provider';

export default function Home() {
  const { login, logout, isLoggedIn, user, isLoading: isAuthLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<TestResult>({
    status: 'IDLE',
    events: [],
  });
  const router = useRouter();

  useEffect(() => {
    if (!isAuthLoading && isLoggedIn) {
      router.push('/projects');
    }
  }, [isLoggedIn, isAuthLoading, router]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (isLoggedIn) {
    return null; // Will redirect
  }

  const handleRunTest = async (data: TestData) => {
    // ... (keep existing handleRunTest logic)
    setIsLoading(true);
    setResult({
      status: 'RUNNING',
      events: [],
    });

    try {
      const response = await fetch('/api/run-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));

              setResult(prev => {
                const newEvents = [...prev.events];

                if (eventData.type === 'log') {
                  newEvents.push({
                    type: 'log',
                    data: { message: eventData.message, level: eventData.level },
                    timestamp: Date.now()
                  });
                } else if (eventData.type === 'screenshot') {
                  newEvents.push({
                    type: 'screenshot',
                    data: { src: eventData.src, label: eventData.label },
                    timestamp: Date.now()
                  });
                } else if (eventData.type === 'status') {
                  return {
                    ...prev,
                    status: eventData.status,
                    error: eventData.error
                  };
                }

                return { ...prev, events: newEvents };
              });
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      setResult(prev => ({
        ...prev,
        status: 'FAIL',
        error: errorMessage
      }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center shadow-sm">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-semibold text-foreground mb-1">
                  Web AutoTest Agent
                </h1>
                <p className="text-muted-foreground text-sm">
                  Intelligent automated testing platform powered by AI
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {!isAuthLoading && (
                <>
                  {isLoggedIn ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600">
                        {user?.email || 'User'}
                      </span>
                      <button
                        onClick={() => logout()}
                        className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors"
                      >
                        Logout
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => login()}
                      className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      Login
                    </button>
                  )}
                </>
              )}
              <div className="h-6 w-px bg-gray-200" />
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-md border border-green-200">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="text-green-700 text-xs font-medium">Online</span>
                </div>
                <div className="px-3 py-1.5 bg-gray-100 rounded-md border border-gray-200">
                  <span className="text-gray-600 text-xs font-medium">v1.0.0</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column - Form */}
          <div className="lg:col-span-5 space-y-6">
            <TestForm onSubmit={handleRunTest} isLoading={isLoading} />
          </div>

          {/* Right Column - Results */}
          <div className="lg:col-span-7 h-full">
            <ResultViewer result={result} />
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-6 border-t border-gray-200">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Powered by Midscene.js & Playwright</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="#" className="hover:text-primary transition-colors">Documentation</a>
              <a href="#" className="hover:text-primary transition-colors">GitHub</a>
              <a href="#" className="hover:text-primary transition-colors">API Reference</a>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}

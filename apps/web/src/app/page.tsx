'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';
import { useI18n } from '@/i18n';
import { Button, CenteredLoading } from '@/components/shared';

export default function Home() {
  const { login, isLoggedIn, isLoading } = useAuth();
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      router.push('/projects');
    }
  }, [isLoggedIn, isLoading, router]);

  if (isLoading) {
    return <CenteredLoading className="min-h-screen" />;
  }

  if (isLoggedIn) {
    return null;
  }

  return (
    <main className="min-h-screen bg-white">
      {/* Hero */}
      <section className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-16 lg:py-20 text-center">
          <h1 className="text-4xl lg:text-5xl font-bold text-blue-600 mb-4">
            SkyTest Agent
          </h1>
          <p className="text-xl text-gray-600 mb-6 max-w-2xl mx-auto">
            {t('landing.subtitle')}
          </p>
          <Button
            onClick={() => login()}
            variant="primary"
            size="md"
            className="h-auto rounded-lg px-8 py-3 text-base"
          >
            {t('landing.loginToStart')}
          </Button>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-12 lg:py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-6">
            {t('landing.features.title')}
          </h2>
          <div className="grid md:grid-cols-2 gap-4 lg:gap-6">
            {/* Multi-Browser Testing */}
            <div className="p-6 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t('landing.features.multiBrowser.title')}
              </h3>
              <p className="text-gray-600 text-sm leading-relaxed">
                {t('landing.features.multiBrowser.desc')}
              </p>
            </div>

            {/* Natural Language */}
            <div className="p-6 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t('landing.features.naturalLanguage.title')}
              </h3>
              <p className="text-gray-600 text-sm leading-relaxed">
                {t('landing.features.naturalLanguage.desc')}
              </p>
            </div>

            {/* Visual Evidence */}
            <div className="p-6 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t('landing.features.screenshots.title')}
              </h3>
              <p className="text-gray-600 text-sm leading-relaxed">
                {t('landing.features.screenshots.desc')}
              </p>
            </div>

            {/* Custom Playwright Code */}
            <div className="p-6 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
              <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {t('landing.features.customCode.title')}
              </h3>
              <p className="text-gray-600 text-sm leading-relaxed">
                {t('landing.features.customCode.desc')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Example */}
      <section className="py-12 lg:py-16 bg-gray-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-8 items-center">
            <div>
              <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-3">
                {t('landing.example.title')}
              </h2>
              <p className="text-gray-600 mb-4 leading-relaxed">
                {t('landing.example.subtitle')}
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {t('landing.example.bullet1')}
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {t('landing.example.bullet2')}
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {t('landing.example.bullet3')}
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm font-mono text-sm">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100">
                <div className="w-3 h-3 rounded-full bg-red-400"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                <div className="w-3 h-3 rounded-full bg-green-400"></div>
              </div>
              <div className="space-y-2 text-gray-700">
                <p>
                  <span className="text-gray-400">1.</span> {t('landing.example.step1')}
                </p>
                <p>
                  <span className="text-gray-400">2.</span> {t('landing.example.step2')}
                </p>
                <p>
                  <span className="text-gray-400">3.</span> {t('landing.example.step3')}
                </p>
                <p>
                  <span className="text-gray-400">4.</span> {t('landing.example.step4')}
                </p>
                <p>
                  <span className="text-gray-400">5.</span> {t('landing.example.step5')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 lg:py-16">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-3">
            {t('landing.cta.title')}
          </h2>
          <p className="text-gray-600 mb-6">{t('landing.cta.subtitle')}</p>
          <Button
            onClick={() => login()}
            variant="primary"
            size="md"
            className="h-auto rounded-lg px-8 py-3 text-base"
          >
            {t('landing.cta.getStarted')}
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-sm text-gray-500 text-center">
            {t('landing.footer', { year: new Date().getFullYear() })}
          </p>
        </div>
      </footer>
    </main>
  );
}

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import "./globals.css";

import { AuthProvider } from "./auth-provider";
import { Header } from "@/components/layout";
import { DevRuntimeErrorLogger } from "@/components/layout/DevRuntimeErrorLogger";
import { I18nProvider } from "@/i18n";
import { LOCALE_META, type Locale } from "@/i18n/messages";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SkyTest Agent",
  description: "Next-generation AI testing platform that executes end-to-end tests in natural language. Powered by Midscene.js and Playwright for autonomous, intelligent quality assurance.",
};

function isLocale(value: string): value is Locale {
  return Object.prototype.hasOwnProperty.call(LOCALE_META, value);
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("skyt_locale")?.value;
  const initialLocale: Locale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : "en";

  return (
    <html lang={LOCALE_META[initialLocale].htmlLang}>
      <body className={`${inter.className} antialiased`}>
        <I18nProvider initialLocale={initialLocale}>
          <AuthProvider>
            <DevRuntimeErrorLogger />
            <Header />
            {children}
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

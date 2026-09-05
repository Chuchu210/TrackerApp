import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AppShell } from '@/components/AppShell';
import { ChunkReloadGuard } from '@/components/ChunkReloadGuard';
import { Sidebar } from '@/components/Sidebar';
import { SidebarProvider } from '@/components/SidebarContext';
import { TestModeBanner } from '@/components/TestModeBanner';
import { ToastProvider } from '@/components/Toast';
import { auth } from '@/auth';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Tracker Admin',
  description: 'Native tracking infrastructure admin',
};

const themeScript = `
(function () {
  try {
    var t = localStorage.getItem('theme');
    var dark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ChunkReloadGuard />
        <SidebarProvider>
          <ToastProvider>
            <Sidebar userEmail={session?.user?.email} />
            <AppShell>
              <main className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px]">
                <TestModeBanner />
                {children}
              </main>
            </AppShell>
          </ToastProvider>
        </SidebarProvider>
      </body>
    </html>
  );
}

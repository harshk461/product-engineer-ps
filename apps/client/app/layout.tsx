import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Webhook Retry Engine',
  description: 'Real-time observability for idempotent webhook ingestion, retries and delivery',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applied before paint so a chosen theme never flashes the other palette. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t&&t!=='system')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}

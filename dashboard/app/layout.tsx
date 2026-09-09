import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Self-Healing E2E Tests',
  description: 'Read-only view of every heal attempt.',
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page">
          <header className="page-header">
            <h1 className="page-title">Self-Healing E2E Tests</h1>
            <p className="page-subtitle">
              Every heal attempt, newest first. A fix is only ever recorded as healed after the
              test was re-executed and passed. This tool never merges.
            </p>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}

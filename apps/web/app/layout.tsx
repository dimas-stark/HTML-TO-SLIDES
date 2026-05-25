import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HTML to Slides — Export Platform',
  description: 'Convert AI-generated HTML presentations to PPTX, PDF, and images',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

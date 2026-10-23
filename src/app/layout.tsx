import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Lexora — Smart Vocabulary Studio', description: 'Không gian học từ vựng thông minh, theo cách của bạn.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="vi"><body>{children}</body></html>; }

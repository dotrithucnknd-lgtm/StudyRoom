import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'VanLet — Học từ vựng mỗi ngày', description: 'Học từ vựng nhẹ nhàng mỗi ngày cùng VanLet.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="vi"><body>{children}</body></html>; }

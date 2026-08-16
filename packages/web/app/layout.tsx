import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'meowbase · 喵窝',
  description: '多 Agent 协作平台',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}

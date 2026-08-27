import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // e2e:web 用独立目录,避免 next build 覆盖人正在用的 .next(踩坑 2)
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
};

export default nextConfig;

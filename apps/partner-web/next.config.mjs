const apiOrigin = process.env.SCO_API_ORIGIN ?? 'http://127.0.0.1:3101';
const nextConfig = { reactStrictMode: true, output: 'standalone', async rewrites() { return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }]; } };
export default nextConfig;

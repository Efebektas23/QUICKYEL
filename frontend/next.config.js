const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development'
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
  // Validate environment variables at build time
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  },
};

// Build-time validation for API URL
if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL) {
  console.warn('⚠️ WARNING: NEXT_PUBLIC_API_URL is not set in production!');
  console.warn('⚠️ The app will use fallback URL: http://localhost:8000');
  console.warn('⚠️ Make sure to set NEXT_PUBLIC_API_URL in Railway environment variables and redeploy.');
} else if (process.env.NEXT_PUBLIC_API_URL) {
  console.log('✅ NEXT_PUBLIC_API_URL configured:', process.env.NEXT_PUBLIC_API_URL);
}

module.exports = withPWA(nextConfig);

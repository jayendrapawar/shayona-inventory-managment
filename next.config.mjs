/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Allow local network devices (phones, tablets on the same Wi-Fi) to
  // access HMR/webpack dev resources without the cross-origin block warning.
  allowedDevOrigins: [
    '192.168.29.112',
    '192.168.*.*',
  ],
}

export default nextConfig

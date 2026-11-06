import type { NextConfig } from "next";

// Security headers applied to every response.
// - HSTS/X-Frame-Options/Referrer-Policy/etc. are baseline hardening for production.
// - Permissions-Policy restricts camera/mic APIs (file-input `capture` dialogs
//   are unaffected — it only governs getUserMedia-style API access).
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,

  // Do not advertise the framework version.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;

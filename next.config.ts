import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy. MediaPipe runs as WebAssembly ('wasm-unsafe-eval') and loads its
// models from Google's model CDN; everything else is same-origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' https://storage.googleapis.com${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Camera and microphone are only ever requested by our own origin (the Room and Drills).
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The floating dev-tools badge sits over the page in development; errors still open the overlay.
  devIndicators: false,
  serverExternalPackages: ["@libsql/client", "libsql"],
  // Runtime data (SQLite, encrypted media) and tests must never be traced into a deployment bundle.
  outputFileTracingExcludes: { "*": ["data/**", "tests/**", "playwright-report/**", "test-results/**"] },
  // Published validation results are read at request time by /trust; migrations run on first query.
  outputFileTracingIncludes: { "/trust": ["docs/validation/*.json"], "/trust/reports/[report]": ["docs/validation/*.md"], "*": ["drizzle/**"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

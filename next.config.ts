import type { NextConfig } from "next";

/** Sent on every response. A nonce-based script CSP is added in M7 hardening. */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** Cross-origin isolation lets onnxruntime-web run the OCR models on several threads (SharedArrayBuffer). */
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: [...securityHeaders, ...isolationHeaders] },
      // Model files are versioned by folder name (ppocr-v4): cache them for a year.
      { source: "/models/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;

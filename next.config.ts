import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy. The only third-party origin the browser talks to is the OpenFreeMap tile server
 * (map style, vector tiles, glyphs, sprites); place search goes through our own /api/geocode. Next.js emits
 * small inline scripts, so `script-src` needs 'unsafe-inline' (a per-request nonce would force every page to be
 * dynamic); everything else is locked down.
 */
const TILES = "https://tiles.openfreemap.org";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${TILES}`,
  "font-src 'self' data:",
  `connect-src 'self' ${TILES}${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "child-src blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;

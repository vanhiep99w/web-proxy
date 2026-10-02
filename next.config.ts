import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  // Isolate concurrent frontend/home/test dev servers. Production uses .next.
  distDir: process.env.RELAY_DEV_DIST_DIR || ".next",
  serverExternalPackages: ["youtubei.js", "quickjs-emscripten"],
  // Keep QuickJS's dynamically loaded WASM in Vercel's function bundle.
  outputFileTracingIncludes: {
    "/api/video": ["./node_modules/@jitl/quickjs-*/dist/**/*"],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    }];
  },
};

export default config;

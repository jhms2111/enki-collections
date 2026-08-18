import type { NextConfig } from "next";

export function buildContentSecurityPolicy(environment: Readonly<{
  nodeEnv?: string;
  vercel?: string;
  vercelEnv?: string;
}> = {
  nodeEnv: process.env.NODE_ENV,
  vercel: process.env.VERCEL,
  vercelEnv: process.env.VERCEL_ENV,
}): string {
  const allowsDevelopmentEval = environment.nodeEnv === "development"
    && !environment.vercel
    && !environment.vercelEnv;
  const scriptSource = `script-src 'self' 'unsafe-inline'${allowsDevelopmentEval ? " 'unsafe-eval'" : ""}`;
  return `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; ${scriptSource}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    const internalHtmlCacheControl = [
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
    ];
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=()",
      },
      {
        key: "Content-Security-Policy",
        value: buildContentSecurityPolicy(),
      },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
    ];
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/demo/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/demo-access",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/api/v1/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/internal-access",
        headers: internalHtmlCacheControl,
      },
      {
        source: "/internal/:path*",
        headers: internalHtmlCacheControl,
      },
    ];
  },
};

export default nextConfig;

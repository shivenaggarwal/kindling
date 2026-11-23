import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kindling is a dynamic, database-driven internal tool, so we use the
  // request-time rendering model rather than Cache Components.
  cacheComponents: false,
  serverExternalPackages: ["postgres", "@googleapis/gmail", "@googleapis/calendar"],
  experimental: {
    // Vercel restores the build cache between deploys, and the Tailwind loader's
    // output was served stale from it (old stylesheet after a CSS change).
    // Builds are fast, so always compile from scratch.
    turbopackFileSystemCacheForBuild: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

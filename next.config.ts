import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kindling is a dynamic, database-driven internal tool, so we use the
  // request-time rendering model rather than Cache Components.
  cacheComponents: false,
  serverExternalPackages: ["postgres", "@googleapis/gmail", "@googleapis/calendar"],
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

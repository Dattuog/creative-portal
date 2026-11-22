import type { NextConfig } from "next";

// Every page here reads live, per-user data (cookies / RLS), so we render
// dynamically and keep Cache Components off to avoid stale numbers.
const nextConfig: NextConfig = {
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

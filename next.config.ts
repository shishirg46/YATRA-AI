/**
 * FILE: next.config.ts
 * LOCATION: /next.config.ts  (project root, same level as package.json)
 * PURPOSE: Next.js configuration
 *
 * KEY CHANGE: images.remotePatterns allows next/image to load from Cloudinary.
 * Without this, any <Image src="https://res.cloudinary.com/..." /> will throw:
 *   "Error: Invalid src prop ... hostname not configured under images"
 */

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    remotePatterns: [
      // Cloudinary — used for user profile photos uploaded via /api/user/avatar
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        // pathname: "/your_cloud_name/**",  // optionally restrict to your cloud
      },
      // Wikimedia Commons — category-based default destination images
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
      },
      // Unsplash — destination photo sourcing
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      // Google — used for avatars from Google OAuth sign-in
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      // Gravatar — fallback avatars from Better Auth email accounts
      {
        protocol: "https",
        hostname: "www.gravatar.com",
      },
    ],
  },

  // Turbopack root — use process.cwd() so it works in any environment (CI, dev, prod)
};

export default nextConfig;

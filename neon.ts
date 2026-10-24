import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  auth: true,
  preview: { realtime: { allowedOrigins: ["http://localhost:5173", "http://localhost:5174", "https://moc-workspace.vercel.app"] } },
  functions: {
    hello: {
      name: "MOC API",
      source: "./apps/api/src/function.ts",
      env: {
        NODE_ENV: "production",
        DEMO_MODE: "false",
        WORKSPACE_URL: "http://localhost:5173",
        API_ALLOWED_ORIGINS: "http://localhost:5173,http://localhost:5174",
        // Realtime's sealing secret is pulled locally but is not injected into Functions.
        ...(process.env.NEON_REALTIME_SECRET ? { MOC_REALTIME_SECRET: process.env.NEON_REALTIME_SECRET } : {}),
      },
    },
  },
  buckets: {
    // "private" is the default; use "public_read" for anonymous reads
    assets: { access: "private" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});

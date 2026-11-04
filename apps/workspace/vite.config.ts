import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  envDir: "../..",
  plugins: [react(), tailwind()],
  server: { fs: { allow: ["../.."] }, proxy: { "/api": { target: process.env.API_PROXY_TARGET || "http://localhost:3001", changeOrigin: true } } },
});

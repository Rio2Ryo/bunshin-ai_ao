import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig } from "vite";


const plugins = [react(), tailwindcss(), jsxLocPlugin()];

export default defineConfig({
  plugins,
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(import.meta.dirname, "client", "src") },
      { find: "@shared", replacement: path.resolve(import.meta.dirname, "shared") },
      { find: "@assets", replacement: path.resolve(import.meta.dirname, "attached_assets") },
      // Exact match only — custom shiki shim with ~25 common languages instead of 232
      { find: /^shiki$/, replacement: path.resolve(import.meta.dirname, "client", "src", "lib", "shiki-shim.ts") },
    ],
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2020",
    cssMinify: "lightningcss",
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vendor: React core
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "vendor-react";
          }
          // Vendor: UI library (Radix)
          if (id.includes("@radix-ui/")) {
            return "vendor-radix";
          }
          // Vendor: tRPC + TanStack Query
          if (id.includes("@trpc/") || id.includes("@tanstack/")) {
            return "vendor-data";
          }
          // Vendor: Lucide icons
          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }
          // Mermaid (lazy loaded, large)
          if (id.includes("mermaid")) {
            return "vendor-mermaid";
          }
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});

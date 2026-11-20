import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const API_TARGET = process.env.FREDDO_API_TARGET || "http://127.0.0.1:8710";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "stockpilot-hosted-demo",
      transformIndexHtml(html) {
        // Reuse the existing browser demo; no server database or API credentials.
        return mode === "demo"
          ? html.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-mode="offline">')
          : html;
      },
    },
  ],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
}));

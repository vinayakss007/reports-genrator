import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number.parseInt(process.env.WEB_PORT ?? "5173", 10),
    proxy: {
      "/api": {
        target: process.env.API_BASE_URL ?? "http://localhost:3001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});

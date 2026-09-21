import { defineConfig } from "vite";

export function createViteConfig({
  apiTarget = "http://127.0.0.1:3000",
}: { apiTarget?: string } = {}) {
  return {
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target: apiTarget },
        "/health": { target: apiTarget },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
  };
}

export default defineConfig(createViteConfig());

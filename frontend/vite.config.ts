import { defineConfig } from "vite";
import react from '@vitejs/plugin-react';

export function createViteConfig({
  apiTarget = "http://127.0.0.1:3000",
}: { apiTarget?: string } = {}) {
  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
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

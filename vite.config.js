import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 6000 },
  server: {
    host: "0.0.0.0",
    proxy: {
      "/sync": { target: "ws://localhost:3001", ws: true, changeOrigin: true },
      "/api": { target: "http://localhost:3001", changeOrigin: true }
    }
  }
});

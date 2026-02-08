import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/antd") || id.includes("node_modules/@ant-design")) {
            return "antd-vendor";
          }
          if (id.includes("node_modules/axios")) {
            return "network-vendor";
          }
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 800
  },
  server: {
    port: 5173
  }
});

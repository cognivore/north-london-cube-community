import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  server: {
    port: 17556,
    proxy: {
      "/api": {
        target: "http://localhost:37556",
        changeOrigin: true,
      },
    },
  },
});

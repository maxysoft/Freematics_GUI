import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  clearScreen: false,
  server: {
    strictPort: true,
    port: 5173,
    host: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});

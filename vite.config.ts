import { defineConfig } from "vite";

// Porta fixa exigida pelo Tauri em desenvolvimento.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist" },
});

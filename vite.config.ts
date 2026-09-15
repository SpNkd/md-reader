import { defineConfig } from "vite";

declare const process: { env: Record<string, string | undefined> };

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").pop() || "md-reader";
const base = process.env.VITE_BASE || (process.env.GITHUB_ACTIONS === "true" ? `/${repositoryName}/` : "/");

export default defineConfig({
  base,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
  },
});

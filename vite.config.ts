import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const devHost = loadEnv(mode, process.cwd(), "VITE_").VITE_DEV_HOST || "127.0.0.1";

  return {
    plugins: [react()],
    server: {
      host: devHost,
      port: 5173,
      strictPort: false,
    },
  };
});

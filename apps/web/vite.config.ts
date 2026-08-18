import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

import { resolveWebApiOrigin } from "./src/api-origin.js";

const environmentDirectory = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, environmentDirectory, "");
  const proxyTarget = resolveWebApiOrigin({
    origin: "http://127.0.0.1:4110",
    ...(environment.PUBLIC_API_URL === undefined ? {} : { override: environment.PUBLIC_API_URL }),
  });
  return {
    envDir: environmentDirectory,
    plugins: [react()],
    ...(mode === "development"
      ? {
          server: {
            proxy: {
              "/v1": { target: proxyTarget, changeOrigin: true },
            },
          },
        }
      : {}),
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
      restoreMocks: true,
    },
  };
});

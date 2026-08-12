import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";

export default defineConfig(({ mode }) => {
  const isWebOs = mode === "webos";
  return {
    base: isWebOs ? "./" : "/",
    plugins: [
      react(),
      ...(isWebOs
        ? [legacy({
            targets: ["Chrome >= 53"],
            renderLegacyChunks: true,
            modernPolyfills: true
          })]
        : [])
    ],
    define: {
      __LUMENTV_PLATFORM__: JSON.stringify(isWebOs ? "webos" : "web")
    },
    build: {
      target: isWebOs ? "es2015" : "es2020",
      cssTarget: isWebOs ? "chrome53" : "chrome90",
      sourcemap: true,
      minify: "esbuild",
      assetsInlineLimit: 4096,
      rollupOptions: {
        output: {
          manualChunks: isWebOs ? undefined : { react: ["react", "react-dom"] }
        }
      }
    },
    server: {
      host: "0.0.0.0",
      port: 5173
    }
  };
});

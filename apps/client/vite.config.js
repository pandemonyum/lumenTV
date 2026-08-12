var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var isWebOs = mode === "webos";
    return {
        base: isWebOs ? "./" : "/",
        plugins: __spreadArray([
            react()
        ], (isWebOs
            ? [legacy({
                    targets: ["Chrome >= 53"],
                    renderLegacyChunks: true,
                    modernPolyfills: true
                })]
            : []), true),
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

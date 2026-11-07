import { defineConfig, loadEnv } from "vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.QULAQ_API_TARGET;
  if (target && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(target))
    throw new Error("QULAQ_API_TARGET must be a local backend origin");
  return {
    esbuild: { jsx: "automatic" },
    server: {
      port: 5173,
      strictPort: true,
      host: "127.0.0.1",
      allowedHosts: ["localhost"],
      fs: { strict: true },
      proxy: target ? { "/api": { target, changeOrigin: false } } : undefined,
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
      },
    },
    plugins: [
      {
        name: "local-private-dataset",
        apply: "serve",
        configureServer(server) {
          server.middlewares.use("/__local/dataset", async (req, res) => {
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("X-Content-Type-Options", "nosniff");
            const origin = req.headers.origin;
            if (
              req.method !== "GET" ||
              (origin &&
                !/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin))
            ) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: "Forbidden" }));
              return;
            }
            try {
              res.end(
                await readFile(
                  fileURLToPath(new URL("../dev.json", import.meta.url)),
                  "utf8",
                ),
              );
            } catch {
              res.statusCode = 404;
              res.end(
                JSON.stringify({
                  error:
                    "Локальный dev.json не найден. Поместите его рядом с папкой frontend.",
                }),
              );
            }
          });
        },
      },
    ],
  };
});

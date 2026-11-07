import { defineConfig, loadEnv } from "vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.QULAQ_API_TARGET;
  if (target && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(target))
    throw new Error("QULAQ_API_TARGET must be a local backend origin");
  return {
    // Keep the static bundle relocatable for a future HTML web-resource host.
    base: "./",
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
          // Development only: private audio stays outside public/ and the build.
          server.middlewares.use("/__local/audio", async (req, res) => {
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            const origin = req.headers.origin;
            const match = /^\/([a-zA-Z0-9_-]{1,80})\.mp3$/.exec(req.url || "");
            if (
              !match ||
              !["GET", "HEAD"].includes(req.method || "") ||
              (origin &&
                !/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin)) ||
              req.headers["sec-fetch-site"] === "cross-site"
            ) {
              res.statusCode = 403;
              res.end();
              return;
            }
            try {
              const audio = await readFile(
                fileURLToPath(
                  new URL(`../.local/audio/${match[1]}.mp3`, import.meta.url),
                ),
              );
              res.setHeader("Content-Type", "audio/mpeg");
              res.setHeader("Accept-Ranges", "bytes");
              let start = 0,
                end = audio.length - 1;
              if (req.headers.range) {
                const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
                if (
                  !range ||
                  Number(range[1]) >= audio.length ||
                  (range[2] && Number(range[2]) < Number(range[1]))
                ) {
                  res.statusCode = 416;
                  res.setHeader("Content-Range", `bytes */${audio.length}`);
                  res.end();
                  return;
                }
                start = Number(range[1]);
                if (range[2]) end = Math.min(end, Number(range[2]));
                res.statusCode = 206;
                res.setHeader(
                  "Content-Range",
                  `bytes ${start}-${end}/${audio.length}`,
                );
              }
              res.setHeader("Content-Length", end - start + 1);
              res.end(
                req.method === "HEAD"
                  ? undefined
                  : audio.subarray(start, end + 1),
              );
            } catch {
              res.statusCode = 404;
              res.end();
            }
          });
          server.middlewares.use("/__local/annotations", async (req, res) => {
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
                  fileURLToPath(
                    new URL(
                      "../.local/reference/annotations.json",
                      import.meta.url,
                    ),
                  ),
                  "utf8",
                ),
              );
            } catch {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "Reference file unavailable" }));
            }
          });
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

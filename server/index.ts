import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDatabase } from "./db.js";

// En desarrollo: <repo>/client. En producción: dist/client, junto a dist/server.
const serverDir = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(serverDir, "..", "client");
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

async function main(): Promise<void> {
  const db = openDatabase(config.databasePath);
  const app = createApp(db);

  if (config.env === "development") {
    // Desarrollo: Vite sirve el frontend con recarga en caliente en el mismo puerto.
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: clientRoot,
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      try {
        const template = await readFile(resolve(clientRoot, "index.html"), "utf8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(200).end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
  } else {
    app.use((_req, res, next) => {
      res.setHeader("Content-Security-Policy", PRODUCTION_CSP);
      next();
    });
    app.use(express.static(clientRoot, { index: false, maxAge: "1h" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(resolve(clientRoot, "index.html"));
    });
  }

  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(config.port, host, () => {
    console.log(`Riaggio One en http://${host}:${config.port} (${config.env})`);
  });
}

main().catch((error: unknown) => {
  console.error("No se pudo iniciar Riaggio One:", error instanceof Error ? error.message : error);
  process.exit(1);
});

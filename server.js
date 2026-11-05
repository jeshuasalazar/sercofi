// Servidor del sitio + agente de WhatsApp para Railway.
// Railway define la variable PORT; en local usa 3000.
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const db = require("./agente/db");
const { crearAgente } = require("./agente/nucleo");
const { crearRutas } = require("./agente/rutas");

const { crearBoletin } = require("./agente/boletin");

const ia = require("./agente/ia");
const agente = crearAgente({ db, ia, zernio: require("./agente/zernio") });
const leerNoticias = async () => {
  const datos = JSON.parse(await fs.promises.readFile(path.join(__dirname, "assets/data/boletin.json"), "utf8"));
  return [...datos.noticias].sort((a, b) => b.fecha.localeCompare(a.fecha));
};
const boletin = crearBoletin({ db, ia, correo: require("./agente/correo"), avisarDueno: agente.avisarDueno, leerNoticias });
const rutasApi = crearRutas({ agente, db, boletin });

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".txt", ".xml"]);
// Solo se sirven archivos de estas rutas (nunca server.js, package.json, etc.)
const PUBLIC = [/^\/[\w-]+\.html$/, /^\/assets\/(css|js|img|data)\/[\w.-]+$/, /^\/(robots\.txt|sitemap\.xml)$/];

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000",
};

function resolve(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p === "/") p = "/index.html";
  if (!path.extname(p)) p += ".html"; // URLs limpias: /terminos -> /terminos.html
  if (!PUBLIC.some((re) => re.test(p))) return null;
  const file = path.join(ROOT, p);
  return file.startsWith(ROOT + path.sep) ? file : null;
}

function send(req, res, status, file) {
  const ext = path.extname(file);
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" || ext === ".json" ? "no-cache" : "public, max-age=604800",
    Vary: "Accept-Encoding",
  };
  const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (gzip) headers["Content-Encoding"] = "gzip";
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(file);
  stream.on("error", () => res.end());
  (gzip ? stream.pipe(zlib.createGzip()) : stream).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/") && (await rutasApi(req, res))) return;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  // Redirige el dominio sin www a www (solo si el host es sercofi.mx)
  if (req.headers.host === "sercofi.mx") {
    res.writeHead(301, { Location: "https://www.sercofi.mx" + req.url });
    return res.end();
  }

  let file;
  try { file = resolve(req.url); } catch { file = null; }
  fs.stat(file || "", (err, st) => {
    if (!err && st.isFile()) return send(req, res, 200, file);
    send(req, res, 404, path.join(ROOT, "404.html"));
  });
});

db.iniciar()
  .catch((e) => console.error("[db] no se pudo preparar la base de datos:", e.message))
  .finally(() => server.listen(PORT, "0.0.0.0", () => {
    console.log(`SERCOFI escuchando en el puerto ${PORT}`);
    // Cada despliegue revisa si hay notas nuevas en el boletín y las manda a los suscriptores.
    if (process.env.BOLETIN_AUTO === "1" && process.env.RESEND_API_KEY) {
      setTimeout(() => boletin.enviarPendientes()
        .then((r) => console.log("[boletin] envío automático:", JSON.stringify(r)))
        .catch((e) => console.error("[boletin] envío automático falló:", e.message)), 15000);
    }
  }));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

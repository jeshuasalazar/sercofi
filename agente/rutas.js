"use strict";
// Rutas HTTP del agente. Devuelve true si atendió la petición.
//   POST /api/whatsapp/webhook     <- Zernio (firma X-Zernio-Signature)
//   POST /api/webhooks/formularios <- navegador; reenvía firmado a AGENTE_WEBHOOK_URL
//   POST /api/agente               <- formularios firmados (X-Agente-Firma)
//   GET  /api/agente/registro      <- registro de conversaciones (Authorization: Bearer AGENTE_ADMIN_TOKEN)
//   POST /api/boletin/suscribir    <- navegador; manda correo de confirmación
//   GET  /api/boletin/confirmar    <- enlace del correo de confirmación
//   GET|POST /api/boletin/baja     <- enlace de baja (POST = un clic desde el cliente de correo)
//   POST /api/boletin/enviar       <- manda las notas nuevas (Authorization: Bearer AGENTE_ADMIN_TOKEN)
//   POST /api/correo/webhook       <- Resend email.received (firma Svix, RESEND_WEBHOOK_SECRET)
const { firmar, firmaValida, sanitizar } = require("./util");
const { firmaSvixValida } = require("./correo");

const LIMITE_CUERPO = 64 * 1024;

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = []; let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > LIMITE_CUERPO) { reject(Object.assign(new Error("muy grande"), { status: 413 })); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(partes)));
    req.on("error", reject);
  });
}

function json(res, status, datos) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(datos));
}

// Límite sencillo por IP para el formulario público.
const intentos = new Map();
function permitido(ip) {
  const ahora = Date.now();
  const l = (intentos.get(ip) || []).filter((t) => ahora - t < 10 * 60 * 1000);
  l.push(ahora); intentos.set(ip, l);
  if (intentos.size > 5000) intentos.clear();
  return l.length <= 5;
}

// Normaliza el evento de Zernio. Devuelve null si no hay nada que contestar.
function normalizarZernio(ev, cuentaId) {
  if (!ev || ev.event !== "message.received" || ev.test) return null;
  const m = ev.message || {};
  if (m.platform !== "whatsapp" || m.direction !== "incoming") return null;
  const cuenta = ev.account?.accountId || ev.account?.id;
  if (cuentaId && cuenta && cuenta !== cuentaId) return null;
  if (ev.metadata?.standby || m.metadata?.standby) return null;
  const s = m.sender || {};
  const telefono = String(s.phoneNumber || s.id || "").replace(/\D/g, "");
  return {
    eventoId: ev.id,
    conversationId: m.conversationId || ev.conversation?.id,
    telefono,
    nombre: s.name || s.whatsappUsername || null,
    texto: m.text || (m.metadata?.interactiveId ? String(m.metadata.interactiveId) : ""),
  };
}

function pagina(res, status, titulo, texto) {
  const e = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titulo)} · SERCOFI</title><style>body{font-family:Rubik,Arial,sans-serif;background:#f4f6f8;color:#1d2b36;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px}
main{background:#fff;border-radius:12px;padding:32px;max-width:460px;text-align:center}h1{color:#0b5fa5;font-size:22px}a{color:#0b5fa5;font-weight:600}</style></head>
<body><main><h1>${e(titulo)}</h1><p>${e(texto)}</p><p><a href="/boletin">Ir al boletín fiscal</a></p></main></body></html>`);
}

function crearRutas({ agente, db, boletin, env = process.env, log = console }) {
  const esAdmin = (req) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    // Compara en tiempo constante: HMAC del token recibido contra HMAC del esperado.
    return !!env.AGENTE_ADMIN_TOKEN && firmaValida(token, firmar(env.AGENTE_ADMIN_TOKEN, "registro"), "registro");
  };
  const ipDe = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  return async function rutas(req, res) {
    const url = req.url.split("?")[0];
    if (!url.startsWith("/api/")) return false;
    const params = new URLSearchParams(req.url.split("?")[1] || "");

    try {
      if (req.method === "POST" && url === "/api/whatsapp/webhook") {
        const cuerpo = await leerCuerpo(req);
        const firma = req.headers["x-zernio-signature"] || req.headers["x-late-signature"];
        if (!firmaValida(cuerpo, firma, env.ZERNIO_WEBHOOK_SECRET)) { json(res, 401, { error: "firma inválida" }); return true; }
        let ev; try { ev = JSON.parse(cuerpo); } catch { json(res, 400, { error: "json" }); return true; }
        // Zernio exige respuesta en < 5 s: confirmamos y procesamos después.
        json(res, 200, { ok: true });
        const m = normalizarZernio(ev, env.ZERNIO_ACCOUNT_ID);
        if (m?.conversationId) {
          agente.mensajeEntrante({ ...m, eventoId: m.eventoId || req.headers["x-zernio-event-id"] })
            .catch((e) => log.error("[agente] error al atender:", e));
        }
        return true;
      }

      if (req.method === "POST" && url === "/api/webhooks/formularios") {
        if (!permitido("f:" + ipDe(req))) { json(res, 429, { error: "demasiados intentos" }); return true; }
        let f; try { f = JSON.parse(await leerCuerpo(req)); } catch { json(res, 400, { error: "json" }); return true; }
        if (f.empresa_web) { json(res, 200, { ok: true }); return true; } // honeypot
        if (!f.nombre || !f.telefono || f.privacidad !== true) { json(res, 422, { error: "faltan datos" }); return true; }
        const limpio = {};
        for (const k of ["nombre", "telefono", "email", "ciudad", "urgencia", "nivel", "regimen", "mensaje"]) {
          if (f[k] != null) limpio[k] = sanitizar(String(f[k]).slice(0, 500));
        }
        limpio.servicios = [].concat(f.servicios || []).map((s) => String(s).slice(0, 100)).slice(0, 12);
        limpio.acepta_whatsapp = f.acepta_whatsapp === true;
        limpio.fecha = new Date().toISOString();
        const destino = env.AGENTE_WEBHOOK_URL;
        if (!destino || !env.AGENTE_WEBHOOK_SECRETO) { log.error("[formularios] falta AGENTE_WEBHOOK_URL o AGENTE_WEBHOOK_SECRETO"); json(res, 202, { ok: true }); return true; }
        const cuerpo = JSON.stringify(limpio);
        const r = await fetch(destino, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Agente-Firma": "sha256=" + firmar(cuerpo, env.AGENTE_WEBHOOK_SECRETO) },
          body: cuerpo,
        }).catch((e) => ({ ok: false, status: 0, e }));
        if (!r.ok) log.error("[formularios] el agente respondió", r.status);
        json(res, 202, { ok: true });
        return true;
      }

      if (req.method === "POST" && url === "/api/agente") {
        const cuerpo = await leerCuerpo(req);
        if (!firmaValida(cuerpo, req.headers["x-agente-firma"], env.AGENTE_WEBHOOK_SECRETO)) { json(res, 401, { error: "firma inválida" }); return true; }
        const r = await agente.formulario(JSON.parse(cuerpo));
        json(res, 200, { ok: true, ...r });
        return true;
      }

      if (req.method === "GET" && url === "/api/agente/registro") {
        if (!esAdmin(req)) { json(res, 401, { error: "no autorizado" }); return true; }
        json(res, 200, { conversaciones: await db.registro(200) });
        return true;
      }

      if (boletin && req.method === "POST" && url === "/api/boletin/suscribir") {
        if (!permitido("b:" + ipDe(req))) { json(res, 429, { error: "demasiados intentos" }); return true; }
        let f; try { f = JSON.parse(await leerCuerpo(req)); } catch { json(res, 400, { error: "json" }); return true; }
        if (f.empresa_web) { json(res, 200, { ok: true }); return true; } // honeypot
        if (f.acepto !== true) { json(res, 422, { error: "acepta el aviso de privacidad" }); return true; }
        const r = await boletin.suscribir({ nombre: f.nombre, email: f.email });
        json(res, r.ok ? 200 : 422, r);
        return true;
      }

      if (boletin && req.method === "GET" && url === "/api/boletin/confirmar") {
        const s = await boletin.confirmar(params.get("t"));
        if (!s) pagina(res, 404, "Enlace no válido", "Este enlace ya no es válido. Vuelve a suscribirte desde el boletín.");
        else pagina(res, 200, "¡Suscripción confirmada!", "Te mandamos un correo de bienvenida. Te avisaremos cuando haya cambios fiscales importantes.");
        return true;
      }

      if (boletin && (req.method === "GET" || req.method === "POST") && url === "/api/boletin/baja") {
        const s = await boletin.baja(params.get("t"));
        if (req.method === "POST") { json(res, s ? 200 : 404, { ok: !!s }); return true; }
        if (!s) pagina(res, 404, "Enlace no válido", "No encontramos esta suscripción.");
        else pagina(res, 200, "Listo, te diste de baja", "Ya no recibirás el boletín de SERCOFI. Puedes volver a suscribirte cuando quieras.");
        return true;
      }

      if (boletin && req.method === "POST" && url === "/api/boletin/enviar") {
        if (!esAdmin(req)) { json(res, 401, { error: "no autorizado" }); return true; }
        json(res, 200, await boletin.enviarPendientes({ forzarPrimeraVez: params.get("forzar") === "1" }));
        return true;
      }

      if (boletin && req.method === "POST" && url === "/api/correo/webhook") {
        const cuerpo = (await leerCuerpo(req)).toString("utf8");
        if (!firmaSvixValida(cuerpo, req.headers, env.RESEND_WEBHOOK_SECRET)) { json(res, 401, { error: "firma inválida" }); return true; }
        let ev; try { ev = JSON.parse(cuerpo); } catch { json(res, 400, { error: "json" }); return true; }
        json(res, 200, { ok: true });
        const idEvento = "resend:" + (req.headers["svix-id"] || ev.data?.email_id);
        if (await db.eventoNuevo(idEvento)) {
          boletin.correoEntrante(ev).then((r) => log.log("[correo]", r.accion)).catch((e) => log.error("[correo] error:", e));
        }
        return true;
      }

      json(res, 404, { error: "no existe" });
      return true;
    } catch (e) {
      log.error("[api]", e);
      if (!res.headersSent) json(res, e.status || 500, { error: "error" });
      return true;
    }
  };
}

module.exports = { crearRutas, normalizarZernio };

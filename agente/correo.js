"use strict";
// Cliente mínimo de Resend (envío, lectura de correos recibidos) y verificación de webhooks (Svix).
const crypto = require("node:crypto");

const BASE = "https://api.resend.com";

async function llamar(metodo, ruta, cuerpo, idempotencia) {
  const headers = { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" };
  if (idempotencia) headers["Idempotency-Key"] = idempotencia.slice(0, 256);
  const r = await fetch(BASE + ruta, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Resend ${r.status}: ${datos.message || datos.name || "error"}`), { status: r.status });
  return datos;
}

/** @param {{to:string|string[], subject:string, html:string, text?:string, replyTo?:string, headers?:object, idempotencia?:string}} c */
function enviar(c) {
  return llamar("POST", "/emails", {
    from: process.env.CORREO_REMITENTE || "SERCOFI <boletin@soylumbrera.com>",
    to: [].concat(c.to),
    subject: c.subject,
    html: c.html,
    text: c.text,
    reply_to: c.replyTo || process.env.CORREO_RESPONDER_A || undefined,
    headers: c.headers,
  }, c.idempotencia);
}

// Envía hasta 100 correos en una sola llamada.
function enviarLote(lista) {
  const from = process.env.CORREO_REMITENTE || "SERCOFI <boletin@soylumbrera.com>";
  const replyTo = process.env.CORREO_RESPONDER_A || undefined;
  return llamar("POST", "/emails/batch", lista.map((c) => ({
    from, to: [].concat(c.to), subject: c.subject, html: c.html, text: c.text, reply_to: replyTo, headers: c.headers,
  })));
}

const recibido = (id) => llamar("GET", `/emails/receiving/${encodeURIComponent(id)}`);

// Verificación Svix: HMAC-SHA256 de "id.timestamp.cuerpo" con el secreto (base64 tras "whsec_").
function firmaSvixValida(cuerpo, h, secreto, ahora = Date.now()) {
  const id = h["svix-id"], ts = h["svix-timestamp"], firmas = h["svix-signature"];
  if (!secreto || !id || !ts || !firmas) return false;
  if (Math.abs(ahora / 1000 - Number(ts)) > 300) return false; // máximo 5 minutos de diferencia
  const clave = Buffer.from(String(secreto).replace(/^whsec_/, ""), "base64");
  const esperado = crypto.createHmac("sha256", clave).update(`${id}.${ts}.${cuerpo}`).digest();
  return String(firmas).split(" ").some((f) => {
    const [ver, valor] = f.split(",");
    if (ver !== "v1" || !valor) return false;
    const b = Buffer.from(valor, "base64");
    return b.length === esperado.length && crypto.timingSafeEqual(b, esperado);
  });
}

module.exports = { enviar, enviarLote, recibido, firmaSvixValida };

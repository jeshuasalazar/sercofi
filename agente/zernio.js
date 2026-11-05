"use strict";
// Cliente mínimo de la API de Zernio (WhatsApp).
const BASE = process.env.ZERNIO_API_URL || "https://zernio.com/api/v1";

async function llamar(ruta, cuerpo, idempotencia) {
  const headers = {
    Authorization: "Bearer " + process.env.ZERNIO_API_KEY,
    "Content-Type": "application/json",
  };
  if (idempotencia) headers["Idempotency-Key"] = idempotencia;
  const r = await fetch(BASE + ruta, { method: "POST", headers, body: JSON.stringify(cuerpo) });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Zernio ${r.status}: ${datos.error || datos.message || "error"}`);
    e.status = r.status;
    throw e;
  }
  return datos;
}

const cuenta = () => process.env.ZERNIO_ACCOUNT_ID;

// Responde dentro de una conversación (solo dentro de la ventana de 24 h).
function responder(conversationId, mensaje, idempotencia) {
  return llamar(`/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
    { accountId: cuenta(), message: mensaje }, idempotencia);
}

// Abre una conversación con una plantilla aprobada por Meta (fuera de la ventana de 24 h).
async function plantilla(telefono, nombre, parametros, idioma = "es_MX") {
  const r = await llamar("/inbox/conversations", {
    accountId: cuenta(), participantId: telefono,
    templateName: nombre, templateLanguage: idioma, templateParams: parametros,
  });
  return r.data || r;
}

module.exports = { responder, plantilla };

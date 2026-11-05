"use strict";
const crypto = require("node:crypto");

// Horario: L-V 9:00-18:00, sábado 9:00-14:00, hora del centro de México.
function enHorario(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(fecha);
  const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  const min = Number(v.hour) * 60 + Number(v.minute);
  if (["Mon", "Tue", "Wed", "Thu", "Fri"].includes(v.weekday)) return min >= 540 && min < 1080;
  if (v.weekday === "Sat") return min >= 540 && min < 840;
  return false;
}

// Quita datos de tarjeta antes de guardar texto (13-19 dígitos seguidos o con espacios/guiones, CVV).
function sanitizar(texto) {
  if (!texto) return "";
  return String(texto)
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[dato bancario omitido]")
    .replace(/\b(cvv|cvc|nip|pin)\s*[:#]?\s*\d{3,4}\b/gi, "$1 [omitido]");
}

const soloDigitos = (s) => String(s || "").replace(/\D/g, "");

// Normaliza un teléfono mexicano a formato internacional sin "+" (10 dígitos -> 52 + número).
function telefonoInternacional(s) {
  const d = soloDigitos(s);
  if (d.length === 10) return "52" + d;
  if (d.length === 13 && d.startsWith("521")) return "52" + d.slice(3);
  return d;
}

function firmar(cuerpo, secreto) {
  return crypto.createHmac("sha256", secreto).update(cuerpo).digest("hex");
}

function firmaValida(cuerpo, firma, secreto) {
  if (!secreto || !firma) return false;
  const esperado = Buffer.from(firmar(cuerpo, secreto));
  const recibido = Buffer.from(String(firma).replace(/^sha256=/, ""));
  return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
}

const esBaja = (t) => /^\s*baja\s*[.!]?\s*$/i.test(t || "");

module.exports = { enHorario, sanitizar, soloDigitos, telefonoInternacional, firmar, firmaValida, esBaja };

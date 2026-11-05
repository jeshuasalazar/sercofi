"use strict";
// Boletín por correo (Resend): suscripción con confirmación, envío de notas nuevas y
// respuestas automáticas con IA a los correos que mandan los suscriptores.
const crypto = require("node:crypto");
const { sanitizar } = require("./util");

const RESPUESTAS_POR_DIA = 5;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const emailValido = (e) => /^[^\s@<>"]{1,64}@[^\s@<>"]+\.[a-z]{2,}$/i.test(e) && e.length <= 120;

// "Ana López <ana@x.com>" -> { nombre, email }
function direccion(s) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(String(s || ""));
  return m ? { nombre: m[1].trim() || null, email: m[2].trim().toLowerCase() } : { nombre: null, email: String(s || "").trim().toLowerCase() };
}

// Quita el texto citado de una respuesta de correo.
function textoNuevo(texto) {
  const lineas = String(texto || "").replace(/\r/g, "").split("\n");
  const fuera = [];
  for (const l of lineas) {
    if (/^\s*>/.test(l)) break;
    if (/^\s*(El|On)\s.+(escribió|wrote):\s*$/i.test(l)) break;
    if (/^-{2,}\s*(Mensaje original|Original Message)/i.test(l)) break;
    if (/^\s*(De|From):\s.+/i.test(l) && fuera.length) break;
    fuera.push(l);
  }
  return fuera.join("\n").trim().slice(0, 4000);
}

const deHtml = (h) => String(h || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function esAutomatico(correo) {
  const h = Object.fromEntries(Object.entries(correo.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (/bulk|list|junk|auto_reply/.test(h.precedence || "")) return true;
  if (h["x-autoreply"] || h["x-autorespond"] || h["list-id"] || h["list-unsubscribe"]) return true;
  return /^(mailer-daemon|postmaster|no-?reply|noreply|bounce)/i.test(direccion(correo.from).email);
}

function plantilla({ titulo, cuerpo, pie }) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d2b36">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:10px">
<tr><td style="padding:20px 28px;border-bottom:3px solid #0b5fa5;font-size:20px;font-weight:bold;color:#0b5fa5">SERCOFI · Boletín fiscal</td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.55">${titulo ? `<h1 style="font-size:20px;margin:0 0 12px">${titulo}</h1>` : ""}${cuerpo}</td></tr>
<tr><td style="padding:16px 28px;font-size:12px;color:#5b6b78;border-top:1px solid #e5e9ed">${pie}</td></tr>
</table></td></tr></table></body></html>`;
}

function crearBoletin({ db, correo, ia, avisarDueno, leerNoticias, env = process.env, log = console, reloj = () => new Date() }) {
  const sitio = () => (env.SITIO_URL || "https://sercofi.spacegray.mx").replace(/\/$/, "");
  const enlaceBaja = (t) => `${sitio()}/api/boletin/baja?t=${encodeURIComponent(t)}`;
  const pieLegal = (token) =>
    `Recibes este correo porque te suscribiste al boletín de SERCOFI Servicios Contables y Financieros, Ecatepec, Estado de México. ` +
    `<a href="${esc(sitio())}/aviso-privacidad">Aviso de privacidad</a>` +
    (token ? ` · <a href="${esc(enlaceBaja(token))}">Darme de baja</a>` : "") +
    `. Si respondes este correo, te contesta primero un asistente de inteligencia artificial.`;
  const cabecerasBaja = (t) => ({
    "List-Unsubscribe": `<${enlaceBaja(t)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
  const tarjetaNota = (n) =>
    `<div style="margin:0 0 18px;padding:0 0 18px;border-bottom:1px solid #e5e9ed">
<p style="margin:0 0 4px;font-size:12px;color:#5b6b78;text-transform:uppercase">${esc(n.categoria)} · ${esc(n.fecha)}</p>
<h2 style="font-size:17px;margin:0 0 6px">${esc(n.titulo)}</h2>
<p style="margin:0 0 8px">${esc(n.resumen)}</p>
<a href="${esc(sitio())}/boletin?nota=${encodeURIComponent(n.id)}" style="color:#0b5fa5;font-weight:bold">Leer la nota completa →</a></div>`;

  async function suscribir({ nombre, email }) {
    email = String(email || "").trim().toLowerCase();
    nombre = String(nombre || "").trim().slice(0, 80);
    if (!emailValido(email) || !nombre) return { ok: false, error: "datos" };
    const previo = await db.suscriptor(email);
    if (previo?.estado === "activo") return { ok: true }; // no revelamos si ya estaba suscrito
    const token = crypto.randomBytes(24).toString("base64url");
    await db.guardarSuscriptor({ email, nombre, token, estado: "pendiente" });
    const link = `${sitio()}/api/boletin/confirmar?t=${encodeURIComponent(token)}`;
    await correo.enviar({
      to: email,
      subject: "Confirma tu suscripción al boletín de SERCOFI",
      html: plantilla({
        titulo: `Hola ${esc(nombre.split(" ")[0])}, confirma tu suscripción`,
        cuerpo: `<p>Para empezar a recibir el boletín fiscal de SERCOFI (lo último del SAT, el DOF y el Congreso, explicado en simple), confirma tu correo:</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#0b5fa5;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Confirmar suscripción</a></p>
<p style="font-size:13px;color:#5b6b78">Si tú no lo pediste, ignora este correo y no te escribiremos.</p>`,
        pie: pieLegal(null),
      }),
      text: `Hola ${nombre}, confirma tu suscripción al boletín de SERCOFI: ${link}\nSi tú no lo pediste, ignora este correo.`,
      idempotencia: "confirmar-" + token,
    });
    return { ok: true };
  }

  async function confirmar(token) {
    const s = token && (await db.suscriptorPorToken(token));
    if (!s) return null;
    if (s.estado === "activo") return s;
    const activo = await db.guardarSuscriptor({ email: s.email, estado: "activo", confirmado: reloj() });
    const recientes = (await leerNoticias()).slice(0, 3);
    await correo.enviar({
      to: s.email,
      subject: "¡Listo! Ya estás suscrito al boletín de SERCOFI",
      html: plantilla({
        titulo: `Bienvenido, ${esc((s.nombre || "").split(" ")[0])}`,
        cuerpo: `<p>Te avisaremos cuando haya cambios fiscales importantes. Mientras, estas son las notas más recientes:</p>${recientes.map(tarjetaNota).join("")}
<p>¿Tienes una duda? Responde este correo.</p>`,
        pie: pieLegal(s.token),
      }),
      headers: cabecerasBaja(s.token),
      idempotencia: "bienvenida-" + s.token,
    }).catch((e) => log.error("[boletin] no se envió la bienvenida:", e.message));
    return activo;
  }

  async function baja(token) {
    const s = token && (await db.suscriptorPorToken(token));
    if (!s) return null;
    return db.guardarSuscriptor({ email: s.email, estado: "baja", baja_fecha: reloj() });
  }

  /** Manda por correo las notas que aún no se han enviado. La primera vez solo marca las existentes. */
  async function enviarPendientes({ forzarPrimeraVez = false } = {}) {
    const noticias = await leerNoticias();
    const enviadas = await db.noticiasEnviadas();
    if (!enviadas.size && !forzarPrimeraVez) {
      await db.marcarEnviadas(noticias.map((n) => n.id));
      return { base: true, marcadas: noticias.length, enviados: 0 };
    }
    const nuevas = noticias.filter((n) => !enviadas.has(n.id));
    if (!nuevas.length) return { nuevas: 0, enviados: 0 };
    const subs = await db.suscriptoresActivos();
    const asunto = nuevas.length === 1 ? nuevas[0].titulo : `${nuevas.length} novedades fiscales que te interesan`;
    let enviados = 0;
    for (let i = 0; i < subs.length; i += 100) {
      const lote = subs.slice(i, i + 100).map((s) => ({
        to: s.email,
        subject: asunto.slice(0, 150),
        html: plantilla({
          titulo: nuevas.length === 1 ? "" : "Novedades del boletín fiscal",
          cuerpo: `<p>Hola ${esc((s.nombre || "").split(" ")[0])},</p>${nuevas.map(tarjetaNota).join("")}
<p>¿Te surge una duda? Responde este correo.</p>`,
          pie: pieLegal(s.token),
        }),
        headers: cabecerasBaja(s.token),
      }));
      await correo.enviarLote(lote);
      enviados += lote.length;
    }
    await db.marcarEnviadas(nuevas.map((n) => n.id));
    return { nuevas: nuevas.length, enviados };
  }

  /** Evento email.received de Resend. */
  async function correoEntrante(evento) {
    const d = evento?.data || {};
    if (evento?.type !== "email.received" || !d.email_id) return { accion: "ignorado" };
    const c = await correo.recibido(d.email_id);
    const { nombre, email } = direccion(c.from || d.from);
    const propios = (env.CORREO_DOMINIOS_PROPIOS || "soylumbrera.com,sercofi.mx").split(",").map((x) => x.trim());
    if (!emailValido(email) || propios.some((dom) => email.endsWith("@" + dom) || email.endsWith("." + dom))) return { accion: "propio" };
    if (esAutomatico(c)) return { accion: "automatico" };

    const asunto = String(c.subject || d.subject || "").slice(0, 200);
    const texto = sanitizar(textoNuevo(c.text || deHtml(c.html)));
    const sub = await db.suscriptor(email);

    // BAJA por correo
    if (/^\s*baja\b/i.test(texto) || /^\s*(re:\s*)?baja\s*$/i.test(asunto)) {
      if (sub) await db.guardarSuscriptor({ email, estado: "baja", baja_fecha: reloj() });
      await responderCorreo(c, email, asunto, "Listo, ya no te enviaremos el boletín. Si algún día necesitas algo, escríbenos cuando quieras.", sub);
      return { accion: "baja" };
    }

    const hoy = reloj().toISOString().slice(0, 10);
    let hilo = (await db.hilo(email)) || { email, estado: "bot", respuestas_dia: 0 };
    if (hilo.estado === "humano") return { accion: "silencio_humano" };
    const usadas = String(hilo.dia || "").slice(0, 10) === hoy ? hilo.respuestas_dia : 0;
    if (usadas >= RESPUESTAS_POR_DIA) return { accion: "limite_diario" };
    if (!texto) return { accion: "vacio" };

    const r = await ia.responder([], `Asunto: ${asunto}\n\n${texto}`, { canal: "correo" });
    await responderCorreo(c, email, asunto, r.texto, sub);
    hilo = await db.guardarHilo({ email, respuestas_dia: usadas + 1, dia: hoy, estado: r.pasar ? "humano" : "bot" });

    if (r.pasar) {
      await avisarDueno(
        `📧 Correo del boletín para ti (${r.pasar.motivo})\n` +
        `De: ${nombre || "sin nombre"} <${email}> · Asunto: ${asunto || "—"}\n` +
        `${r.pasar.resumen}\n` +
        `Contesta tú desde tu correo. Para regresarlo al bot escribe aquí: CERRAR ${email}`
      );
      return { accion: "pasada_a_persona", respuesta: r.texto };
    }
    return { accion: "respondida", respuesta: r.texto };
  }

  async function responderCorreo(original, email, asunto, texto, sub) {
    const parrafos = esc(texto).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
    const mid = original.message_id;
    await correo.enviar({
      to: email,
      subject: /^re:/i.test(asunto) ? asunto : "Re: " + (asunto || "Tu mensaje a SERCOFI"),
      html: plantilla({
        cuerpo: parrafos + `<p style="font-size:13px;color:#5b6b78">— Asistente SERCOFI (inteligencia artificial). Si necesitas a una persona, solo dilo.</p>`,
        pie: pieLegal(sub?.token),
      }),
      text: `${texto}\n\n— Asistente SERCOFI (inteligencia artificial). Si necesitas a una persona, solo dilo.`,
      headers: {
        ...(mid ? { "In-Reply-To": mid, References: mid } : {}),
        "Auto-Submitted": "auto-replied",
        ...(sub?.token ? cabecerasBaja(sub.token) : {}),
      },
      idempotencia: "resp-" + (original.id || mid || email + Date.now()),
    });
  }

  return { suscribir, confirmar, baja, enviarPendientes, correoEntrante };
}

module.exports = { crearBoletin, textoNuevo, direccion, esAutomatico };

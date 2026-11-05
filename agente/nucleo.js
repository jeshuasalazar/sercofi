"use strict";
// Lógica del agente, independiente de HTTP. Las dependencias se inyectan para poder probarla.
const { FUERA_DE_HORARIO, AVISO_IA, NEGOCIO } = require("./conocimiento");
const { enHorario, sanitizar, telefonoInternacional, esBaja } = require("./util");

const DIA = 24 * 60 * 60 * 1000;
const PIE_BAJA = "Si no quieres recibir más mensajes, responde BAJA.";

function crearAgente({ db, ia, zernio, reloj = () => new Date(), env = process.env, log = console }) {
  const dueno = () => telefonoInternacional(env.AVISO_WHATSAPP_DUENO);
  const colas = new Map(); // un mensaje a la vez por conversación

  function enCola(clave, tarea) {
    const previa = colas.get(clave) || Promise.resolve();
    const siguiente = previa.catch(() => {}).then(tarea);
    colas.set(clave, siguiente);
    siguiente.finally(() => { if (colas.get(clave) === siguiente) colas.delete(clave); }).catch(() => {});
    return siguiente;
  }

  async function enviar(conv, texto, rol = "assistant") {
    await zernio.responder(conv.id, texto);
    await db.agregarMensaje(conv.id, rol, sanitizar(texto));
  }

  async function avisarDueno(texto) {
    const tel = dueno();
    if (!tel) return log.error("[agente] Falta AVISO_WHATSAPP_DUENO; aviso no enviado:", texto);
    try {
      const conv = await db.conversacionPorTelefono(tel);
      const abierta = conv && conv.ultimo_entrante && reloj() - new Date(conv.ultimo_entrante) < DIA;
      if (abierta) return await zernio.responder(conv.id, texto);
      if (env.PLANTILLA_AVISO_DUENO) {
        // Los parámetros de plantilla no admiten saltos de línea.
        const unaLinea = texto.replace(/\s*\n+\s*/g, " · ").slice(0, 900);
        return await zernio.plantilla(tel, env.PLANTILLA_AVISO_DUENO, [unaLinea], env.PLANTILLA_IDIOMA || "es_MX");
      }
      log.error("[agente] La ventana de 24 h con el dueño está cerrada y no hay PLANTILLA_AVISO_DUENO. Aviso:", texto);
    } catch (e) {
      log.error("[agente] No se pudo avisar al dueño:", e.message);
    }
  }

  // Mensajes del dueño al número del bot: comandos para cerrar el paso a persona.
  async function comandoDueno(m) {
    await db.guardarConversacion({ id: m.conversationId, telefono: m.telefono, nombre: m.nombre, origen: "dueno", ultimo_entrante: reloj() });
    const correoCmd = /^\s*cerrar\s+(\S+@\S+\.\S+)\s*$/i.exec(m.texto || "");
    if (correoCmd) {
      const email = correoCmd[1].toLowerCase();
      if (!(await db.hilo(email))) return zernio.responder(m.conversationId, "No encontré un correo de " + email + ".");
      await db.guardarHilo({ email, estado: "bot" });
      return zernio.responder(m.conversationId, "Listo, los correos de " + email + " los vuelve a contestar el bot.");
    }
    const cmd = /^\s*cerrar\s*\+?([\d\s-]{8,})\s*$/i.exec(m.texto || "");
    if (!cmd) {
      return zernio.responder(m.conversationId,
        "Hola " + NEGOCIO.persona.split(" ")[0] + ". Para regresar una conversación al bot escribe: CERRAR seguido del número del cliente (ej. CERRAR 5215512345678) o de su correo.");
    }
    const tel = telefonoInternacional(cmd[1]);
    const conv = await db.conversacionPorTelefono(tel);
    if (!conv) return zernio.responder(m.conversationId, "No encontré una conversación con " + cmd[1].trim() + ".");
    await db.guardarConversacion({ id: conv.id, estado: "bot" });
    return zernio.responder(m.conversationId, "Listo, la conversación con " + (conv.nombre || conv.telefono) + " regresó al bot.");
  }

  /** Mensaje entrante de WhatsApp (ya validado y normalizado). */
  async function mensajeEntrante(m) {
    if (m.eventoId && !(await db.eventoNuevo(m.eventoId))) return { accion: "duplicado" };
    m = { ...m, telefono: telefonoInternacional(m.telefono) };
    if (m.telefono && m.telefono === dueno()) { await comandoDueno(m); return { accion: "dueno" }; }
    return enCola(m.conversationId, () => atender(m));
  }

  async function atender(m) {
    const previa = await db.conversacion(m.conversationId);
    let conv = await db.guardarConversacion({
      id: m.conversationId, telefono: m.telefono, nombre: m.nombre || previa?.nombre, ultimo_entrante: reloj(),
    });
    const texto = sanitizar(m.texto || "").trim();

    if (esBaja(texto)) {
      await db.guardarContacto({ telefono: m.telefono, baja: true });
      await db.agregarMensaje(conv.id, "user", texto);
      await enviar(conv, "Listo, ya no te enviaremos mensajes. Si algún día necesitas algo, escríbenos cuando quieras.");
      return { accion: "baja" };
    }

    if (conv.estado === "humano") {
      await db.agregarMensaje(conv.id, "user", texto || "[archivo]");
      return { accion: "silencio_humano" };
    }

    const aviso = conv.aviso_ia_enviado ? "" : AVISO_IA + "\n\n";
    const marcarAviso = async () => { if (aviso) conv = await db.guardarConversacion({ id: conv.id, aviso_ia_enviado: true }); };

    if (!texto) {
      await enviar(conv, aviso + "Por ahora solo puedo leer mensajes de texto. ¿Me lo puedes escribir?");
      await marcarAviso();
      return { accion: "sin_texto" };
    }

    if (!enHorario(reloj())) {
      const historial = await db.historial(conv.id);
      await db.agregarMensaje(conv.id, "user", texto);
      const ultimo = historial.filter((h) => h.rol === "assistant").pop();
      if (ultimo && ultimo.texto.endsWith(FUERA_DE_HORARIO)) return { accion: "fuera_de_horario_repetido" };
      await enviar(conv, aviso + FUERA_DE_HORARIO);
      await marcarAviso();
      return { accion: "fuera_de_horario" };
    }

    const historial = await db.historial(conv.id);
    const r = await ia.responder(historial, texto);
    await db.agregarMensaje(conv.id, "user", texto);
    await enviar(conv, aviso + r.texto);
    await marcarAviso();

    if (r.pasar) {
      await db.guardarConversacion({
        id: conv.id, estado: "humano", pasada_a_persona: true, veces_pasada: (conv.veces_pasada || 0) + 1,
      });
      await avisarDueno(
        `🔔 Conversación para ti (${r.pasar.motivo})\n` +
        `Cliente: ${conv.nombre || "sin nombre"} · +${conv.telefono}\n` +
        `${r.pasar.resumen}\n` +
        `Contesta desde la bandeja de Zernio. Para regresarla al bot escribe aquí: CERRAR ${conv.telefono}`
      );
      return { accion: "pasada_a_persona", respuesta: r.texto, motivo: r.pasar.motivo };
    }
    return { accion: "respondida", respuesta: r.texto };
  }

  /** Formulario de la web (ya verificado con HMAC). */
  async function formulario(f) {
    const tel = telefonoInternacional(f.telefono);
    const acepta = f.acepta_whatsapp === true || f.acepta_whatsapp === "true" || f.acepta_whatsapp === "on";
    const contacto = tel ? await db.contacto(tel) : null;
    if (tel) await db.guardarContacto({ telefono: tel, nombre: f.nombre || null, acepta_whatsapp: acepta });

    let escrito = false, motivo = "";
    if (!tel) motivo = "sin teléfono válido";
    else if (!acepta) motivo = "no aceptó WhatsApp";
    else if (contacto?.baja) motivo = "pidió BAJA antes";
    else if (!env.PLANTILLA_BIENVENIDA) motivo = "falta plantilla aprobada (PLANTILLA_BIENVENIDA)";
    else {
      try {
        const nombre = String(f.nombre || "").trim().split(/\s+/)[0] || "hola";
        const r = await zernio.plantilla(tel, env.PLANTILLA_BIENVENIDA, [nombre], env.PLANTILLA_IDIOMA || "es_MX");
        if (r?.conversationId) {
          await db.guardarConversacion({ id: r.conversationId, telefono: tel, nombre: f.nombre || null, origen: "formulario" });
        }
        escrito = true;
      } catch (e) {
        motivo = "error al enviar plantilla: " + e.message;
      }
    }

    await avisarDueno(
      `📝 Nuevo formulario web${f.nivel ? " (" + f.nivel + ")" : ""}\n` +
      `${f.nombre || "Sin nombre"} · ${f.telefono || "sin teléfono"} · ${f.email || "sin correo"}\n` +
      `Necesita: ${[].concat(f.servicios || []).join(", ") || "—"} · Urgencia: ${f.urgencia || "—"}\n` +
      (escrito ? "El bot ya le escribió por WhatsApp." : `El bot NO le escribió (${motivo}).`)
    );
    return { escrito, motivo };
  }

  return { mensajeEntrante, formulario, avisarDueno, PIE_BAJA };
}

module.exports = { crearAgente };

"use strict";
// Genera la respuesta del agente con la API de OpenAI.
// Caché de prompt: OpenAI la aplica sola al prefijo fijo (system + herramientas, > 1024 tokens);
// prompt_cache_key agrupa todas las peticiones del agente para que caigan en la misma caché.
const OpenAI = require("openai");
const { SYSTEM, HERRAMIENTAS, NEGOCIO } = require("./conocimiento");

const MODELO = process.env.AGENTE_MODELO || "gpt-5.4-mini";
let cliente;
const api = () => (cliente ||= new OpenAI()); // usa OPENAI_API_KEY

// Las herramientas se definen una vez en formato OpenAI (orden fijo para no romper la caché).
const TOOLS = HERRAMIENTAS.map((h) => ({
  type: "function", name: h.name, description: h.description, strict: true, parameters: h.input_schema,
}));

const PASO_GENERICO = `Prefiero que esto lo vea una persona del equipo. ${NEGOCIO.persona}, de SERCOFI, te escribirá por aquí.`;

/**
 * @param {{rol:"user"|"assistant", texto:string}[]} historial  últimos mensajes (sin el actual)
 * @param {string} texto  mensaje nuevo del cliente
 * @returns {Promise<{texto:string, pasar:null|{motivo:string,resumen:string}, uso?:object}>}
 */
async function responder(historial, texto) {
  const input = historial.map((m) => ({ role: m.rol, content: m.texto }));
  input.push({ role: "user", content: texto });

  const r = await api().responses.create({
    model: MODELO,
    instructions: SYSTEM,
    input,
    tools: TOOLS,
    tool_choice: "auto",
    parallel_tool_calls: false,
    reasoning: { effort: "low" },
    max_output_tokens: 2000,
    prompt_cache_key: "sercofi-agente-whatsapp",
    store: false, // no guardamos conversaciones en OpenAI
  });

  const llamada = (r.output || []).find((o) => o.type === "function_call" && o.name === "pasar_a_persona");
  if (llamada) {
    let datos = {};
    try { datos = JSON.parse(llamada.arguments); } catch {}
    return {
      texto: datos.mensaje_cliente || PASO_GENERICO,
      pasar: { motivo: datos.motivo || "no_se", resumen: datos.resumen || "Mensaje: " + texto.slice(0, 200) },
      uso: r.usage,
    };
  }

  const negado = (r.output || []).some((o) => o.type === "message" && (o.content || []).some((c) => c.type === "refusal"));
  const respuesta = (r.output_text || "").trim();
  if (!respuesta || negado || r.status === "incomplete") {
    return { texto: PASO_GENERICO, pasar: { motivo: "no_se", resumen: "El asistente no pudo responder.\nMensaje: " + texto.slice(0, 200) }, uso: r.usage };
  }
  return { texto: respuesta, pasar: null, uso: r.usage };
}

module.exports = { responder, MODELO };

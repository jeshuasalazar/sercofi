"use strict";
// Pruebas de la lógica del agente sin llamar a servicios externos.
const test = require("node:test");
const assert = require("node:assert/strict");
const { crearAgente } = require("../agente/nucleo");
const { memoria } = require("../agente/db");
const { enHorario, sanitizar, firmar, firmaValida, telefonoInternacional } = require("../agente/util");
const { normalizarZernio } = require("../agente/rutas");
const { FUERA_DE_HORARIO } = require("../agente/conocimiento");

// Miércoles 12:00 y 22:00 hora de CDMX (UTC-6).
const ABIERTO = new Date("2026-11-04T18:00:00Z");
const CERRADO = new Date("2026-11-05T04:00:00Z");
const DUENO = "525511112222";

function armar({ reloj = ABIERTO, respuesta = { texto: "Hola, ¿en qué te ayudo?", pasar: null }, env = {} } = {}) {
  const enviados = [], plantillas = [];
  const db = memoria();
  const ia = { llamadas: 0, async responder() { ia.llamadas++; return typeof respuesta === "function" ? respuesta() : respuesta; } };
  const zernio = {
    async responder(id, texto) { enviados.push({ id, texto }); return {}; },
    async plantilla(tel, nombre, params) { plantillas.push({ tel, nombre, params }); return { conversationId: "conv-" + tel }; },
  };
  const agente = crearAgente({
    db, ia, zernio, reloj: () => reloj,
    env: { AVISO_WHATSAPP_DUENO: "+52 1 55 1111 2222", ...env }, log: { error() {} },
  });
  return { agente, db, ia, enviados, plantillas };
}
const msg = (texto, extra = {}) => ({ conversationId: "c1", telefono: "5215533334444", nombre: "Ana", texto, ...extra });

test("horario: L-V 9-18 y sábado 9-14 en CDMX", () => {
  assert.equal(enHorario(ABIERTO), true);
  assert.equal(enHorario(CERRADO), false);
  assert.equal(enHorario(new Date("2026-11-07T19:00:00Z")), true);  // sábado 13:00
  assert.equal(enHorario(new Date("2026-11-07T21:00:00Z")), false); // sábado 15:00
  assert.equal(enHorario(new Date("2026-11-08T18:00:00Z")), false); // domingo
});

test("no se guardan datos de tarjeta", () => {
  const t = sanitizar("mi tarjeta es 4152 3135 1234 5678 y cvv 123");
  assert.doesNotMatch(t, /4152|5678|123\b/);
});

test("firma HMAC: válida, inválida y vacía", () => {
  const cuerpo = '{"a":1}';
  assert.equal(firmaValida(cuerpo, firmar(cuerpo, "s"), "s"), true);
  assert.equal(firmaValida(cuerpo, "sha256=" + firmar(cuerpo, "s"), "s"), true);
  assert.equal(firmaValida(cuerpo, firmar(cuerpo, "otro"), "s"), false);
  assert.equal(firmaValida(cuerpo, "", "s"), false);
});

test("teléfono mexicano a formato internacional", () => {
  assert.equal(telefonoInternacional("55 3988 7605"), "525539887605");
  assert.equal(telefonoInternacional("+52 1 55 3988 7605"), "525539887605");
});

test("normaliza evento de Zernio y descarta los que no aplican", () => {
  const ev = {
    id: "ev1", event: "message.received", account: { accountId: "acc" },
    message: { conversationId: "c9", platform: "whatsapp", direction: "incoming", text: "hola", sender: { id: "5215500000000", name: "Luis" } },
  };
  assert.deepEqual(normalizarZernio(ev, "acc"), { eventoId: "ev1", conversationId: "c9", telefono: "5215500000000", nombre: "Luis", texto: "hola" });
  assert.equal(normalizarZernio({ ...ev, event: "message.sent" }, "acc"), null);
  assert.equal(normalizarZernio(ev, "otra-cuenta"), null);
  assert.equal(normalizarZernio({ ...ev, message: { ...ev.message, platform: "instagram" } }, "acc"), null);
});

test("primer mensaje se presenta como asistente de IA, el segundo no", async () => {
  const { agente, enviados } = armar();
  await agente.mensajeEntrante(msg("hola"));
  await agente.mensajeEntrante(msg("¿qué servicios tienen?"));
  assert.match(enviados[0].texto, /asistente de inteligencia artificial/);
  assert.doesNotMatch(enviados[1].texto, /inteligencia artificial/);
});

test("fuera de horario responde el mensaje fijo, una sola vez, sin llamar a la IA", async () => {
  const { agente, enviados, ia } = armar({ reloj: CERRADO });
  await agente.mensajeEntrante(msg("hola"));
  await agente.mensajeEntrante(msg("¿siguen ahí?"));
  assert.equal(enviados.length, 1);
  assert.ok(enviados[0].texto.endsWith(FUERA_DE_HORARIO));
  assert.equal(ia.llamadas, 0);
});

test("paso a persona: avisa al dueño con resumen y el bot deja de contestar hasta CERRAR", async () => {
  const { agente, db, enviados, ia } = armar({
    respuesta: { texto: "Te paso con Edith.", pasar: { motivo: "queja", resumen: "Cliente molesto por retraso.\nPide llamada." } },
  });
  // El dueño escribió hace poco: ventana de 24 h abierta.
  await agente.mensajeEntrante({ conversationId: "cd", telefono: DUENO, texto: "hola" });
  enviados.length = 0;

  const r = await agente.mensajeEntrante(msg("quiero poner una queja"));
  assert.equal(r.accion, "pasada_a_persona");
  const aviso = enviados.find((e) => e.id === "cd");
  assert.match(aviso.texto, /Cliente molesto por retraso/);
  assert.match(aviso.texto, /CERRAR 525533334444/);

  const silencio = await agente.mensajeEntrante(msg("¿hola?"));
  assert.equal(silencio.accion, "silencio_humano");
  assert.equal(ia.llamadas, 1);

  await agente.mensajeEntrante({ conversationId: "cd", telefono: DUENO, texto: "CERRAR 5215533334444" });
  assert.equal((await db.conversacion("c1")).estado, "bot");
  assert.equal((await db.conversacion("c1")).pasada_a_persona, true); // queda en el registro
});

test("BAJA confirma y bloquea mensajes proactivos posteriores", async () => {
  const { agente, enviados, plantillas } = armar({ env: { PLANTILLA_BIENVENIDA: "bienvenida" } });
  await agente.mensajeEntrante(msg("BAJA"));
  assert.match(enviados[0].texto, /ya no te enviaremos mensajes/);
  const r = await agente.formulario({ nombre: "Ana", telefono: "+52 1 55 3333 4444", acepta_whatsapp: true });
  assert.equal(r.escrito, false);
  assert.equal(plantillas.filter((p) => p.nombre === "bienvenida").length, 0);
});

test("formulario: solo escribe al cliente si aceptó WhatsApp; siempre avisa al dueño", async () => {
  const { agente, plantillas } = armar({ env: { PLANTILLA_BIENVENIDA: "bienvenida", PLANTILLA_AVISO_DUENO: "aviso" } });
  const no = await agente.formulario({ nombre: "Beto Ruiz", telefono: "5512345678", acepta_whatsapp: false });
  assert.equal(no.escrito, false);
  assert.deepEqual(plantillas.map((p) => p.nombre), ["aviso"]);
  assert.equal(plantillas[0].tel, DUENO);
  assert.doesNotMatch(plantillas[0].params[0], /\n/);

  const si = await agente.formulario({ nombre: "Carla Díaz", telefono: "5587654321", acepta_whatsapp: true });
  assert.equal(si.escrito, true);
  assert.deepEqual(plantillas.slice(1).map((p) => [p.nombre, p.tel]), [["bienvenida", "525587654321"], ["aviso", DUENO]]);
  assert.deepEqual(plantillas[1].params, ["Carla"]);
});

test("eventos duplicados de Zernio se ignoran", async () => {
  const { agente, enviados } = armar();
  await agente.mensajeEntrante(msg("hola", { eventoId: "e1" }));
  const r = await agente.mensajeEntrante(msg("hola", { eventoId: "e1" }));
  assert.equal(r.accion, "duplicado");
  assert.equal(enviados.length, 1);
});

"use strict";
// Pruebas del boletín por correo y de las respuestas automáticas, sin llamar a servicios externos.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { crearBoletin, textoNuevo, direccion } = require("../agente/boletin");
const { firmaSvixValida } = require("../agente/correo");
const { memoria } = require("../agente/db");
const { crearAgente } = require("../agente/nucleo");

const NOTAS = [
  { id: "n2", fecha: "2026-11-02", categoria: "sat", titulo: "Nota dos", resumen: "Resumen dos" },
  { id: "n1", fecha: "2026-10-30", categoria: "dof", titulo: "Nota uno", resumen: "Resumen uno" },
];

function armar({ respuesta = { texto: "Gracias por escribir.", pasar: null }, recibido = {} } = {}) {
  const db = memoria();
  const enviados = [], lotes = [], avisos = [];
  let notas = [...NOTAS];
  const correo = {
    async enviar(c) { enviados.push(c); return { id: "x" }; },
    async enviarLote(l) { lotes.push(l); return { data: [] }; },
    async recibido(id) { return { id, from: "Ana López <ana@cliente.mx>", subject: "Re: Nota dos", text: "¿Esto aplica a RESICO?\n\nEl lun, 3 nov 2026, SERCOFI escribió:\n> texto viejo", message_id: "<m1@cliente.mx>", headers: {}, ...recibido }; },
  };
  const ia = { llamadas: [], async responder(h, t, o) { ia.llamadas.push({ t, o }); return respuesta; } };
  const boletin = crearBoletin({
    db, correo, ia, avisarDueno: async (t) => avisos.push(t), leerNoticias: async () => notas,
    env: { SITIO_URL: "https://sitio.test" }, log: { error() {}, log() {} },
  });
  return { boletin, db, enviados, lotes, avisos, ia, setNotas: (n) => (notas = n) };
}

test("suscripción con doble confirmación y baja", async () => {
  const { boletin, db, enviados } = armar();
  assert.equal((await boletin.suscribir({ nombre: "Ana", email: "correo-malo" })).ok, false);
  assert.equal((await boletin.suscribir({ nombre: "Ana López", email: "ANA@cliente.mx" })).ok, true);
  const s = await db.suscriptor("ana@cliente.mx");
  assert.equal(s.estado, "pendiente");
  assert.match(enviados[0].html, new RegExp("/api/boletin/confirmar\\?t=" + s.token));
  assert.equal((await db.suscriptoresActivos()).length, 0);

  assert.equal(await boletin.confirmar("token-falso"), null);
  await boletin.confirmar(s.token);
  assert.equal((await db.suscriptor("ana@cliente.mx")).estado, "activo");
  assert.match(enviados[1].subject, /Ya estás suscrito/);
  assert.match(enviados[1].headers["List-Unsubscribe"], /\/api\/boletin\/baja\?t=/);

  await boletin.baja(s.token);
  assert.equal((await db.suscriptor("ana@cliente.mx")).estado, "baja");
});

test("envío: la primera vez solo marca las notas; después manda solo las nuevas a los activos", async () => {
  const { boletin, db, lotes, setNotas } = armar();
  await db.guardarSuscriptor({ email: "a@x.mx", nombre: "A", token: "ta", estado: "activo" });
  await db.guardarSuscriptor({ email: "b@x.mx", nombre: "B", token: "tb", estado: "baja" });

  assert.deepEqual(await boletin.enviarPendientes(), { base: true, marcadas: 2, enviados: 0 });
  assert.equal(lotes.length, 0);
  assert.deepEqual(await boletin.enviarPendientes(), { nuevas: 0, enviados: 0 });

  setNotas([{ id: "n3", fecha: "2026-11-05", categoria: "dof", titulo: "Nota tres", resumen: "R3" }, ...NOTAS]);
  assert.deepEqual(await boletin.enviarPendientes(), { nuevas: 1, enviados: 1 });
  assert.equal(lotes[0].length, 1);
  assert.equal(lotes[0][0].to, "a@x.mx");
  assert.equal(lotes[0][0].subject, "Nota tres");
  assert.match(lotes[0][0].html, /boletin\?nota=n3/);
  assert.match(lotes[0][0].html, /baja\?t=ta/);
  assert.deepEqual(await boletin.enviarPendientes(), { nuevas: 0, enviados: 0 });
});

test("correo entrante: responde con IA en el mismo hilo, sin el texto citado", async () => {
  const { boletin, enviados, ia } = armar();
  const r = await boletin.correoEntrante({ type: "email.received", data: { email_id: "e1" } });
  assert.equal(r.accion, "respondida");
  assert.equal(ia.llamadas[0].o.canal, "correo");
  assert.doesNotMatch(ia.llamadas[0].t, /texto viejo/);
  const c = enviados[0];
  assert.equal(c.to, "ana@cliente.mx");
  assert.equal(c.subject, "Re: Nota dos");
  assert.equal(c.headers["In-Reply-To"], "<m1@cliente.mx>");
  assert.equal(c.headers["Auto-Submitted"], "auto-replied");
  assert.match(c.text, /inteligencia artificial/);
});

test("correo entrante: paso a persona avisa por WhatsApp y el bot deja de contestar ese correo", async () => {
  const { boletin, avisos, enviados } = armar({ respuesta: { texto: "Edith te responderá.", pasar: { motivo: "caso_concreto", resumen: "Pregunta si RESICO aplica." } } });
  assert.equal((await boletin.correoEntrante({ type: "email.received", data: { email_id: "e1" } })).accion, "pasada_a_persona");
  assert.match(avisos[0], /CERRAR ana@cliente\.mx/);
  assert.equal((await boletin.correoEntrante({ type: "email.received", data: { email_id: "e2" } })).accion, "silencio_humano");
  assert.equal(enviados.length, 1);
});

test("correo entrante: ignora respuestas automáticas, correos propios y limita a 5 por día", async () => {
  const auto = armar({ recibido: { headers: { "Auto-Submitted": "auto-replied" } } });
  assert.equal((await auto.boletin.correoEntrante({ type: "email.received", data: { email_id: "e" } })).accion, "automatico");
  const propio = armar({ recibido: { from: "SERCOFI <boletin@soylumbrera.com>" } });
  assert.equal((await propio.boletin.correoEntrante({ type: "email.received", data: { email_id: "e" } })).accion, "propio");
  const { boletin } = armar();
  const acciones = [];
  for (let i = 0; i < 6; i++) acciones.push((await boletin.correoEntrante({ type: "email.received", data: { email_id: "e" + i } })).accion);
  assert.deepEqual(acciones.slice(4), ["respondida", "limite_diario"]);
});

test("correo entrante: BAJA da de baja al suscriptor", async () => {
  const { boletin, db } = armar({ recibido: { text: "BAJA" } });
  await db.guardarSuscriptor({ email: "ana@cliente.mx", nombre: "Ana", token: "t", estado: "activo" });
  assert.equal((await boletin.correoEntrante({ type: "email.received", data: { email_id: "e" } })).accion, "baja");
  assert.equal((await db.suscriptor("ana@cliente.mx")).estado, "baja");
});

test("CERRAR <correo> desde el WhatsApp del dueño regresa el correo al bot", async () => {
  const db = memoria();
  await db.guardarHilo({ email: "ana@cliente.mx", estado: "humano" });
  const enviados = [];
  const agente = crearAgente({
    db, ia: {}, zernio: { async responder(id, t) { enviados.push(t); } },
    env: { AVISO_WHATSAPP_DUENO: "5511112222" }, log: { error() {} },
  });
  await agente.mensajeEntrante({ conversationId: "cd", telefono: "525511112222", texto: "CERRAR ana@cliente.mx" });
  assert.equal((await db.hilo("ana@cliente.mx")).estado, "bot");
  assert.match(enviados[0], /vuelve a contestar el bot/);
});

test("utilidades de correo: dirección, texto citado y firma Svix", () => {
  assert.deepEqual(direccion('"Ana López" <Ana@X.mx>'), { nombre: "Ana López", email: "ana@x.mx" });
  assert.equal(textoNuevo("Hola\n\nOn Mon, 3 Nov 2026, X wrote:\n> viejo"), "Hola");

  const secreto = "whsec_" + Buffer.from("clave-secreta").toString("base64");
  const cuerpo = '{"type":"email.received"}', id = "msg_1", ts = String(Math.floor(Date.now() / 1000));
  const firma = crypto.createHmac("sha256", Buffer.from("clave-secreta")).update(`${id}.${ts}.${cuerpo}`).digest("base64");
  const h = { "svix-id": id, "svix-timestamp": ts, "svix-signature": "v1,otra v1," + firma };
  assert.equal(firmaSvixValida(cuerpo, h, secreto), true);
  assert.equal(firmaSvixValida(cuerpo + " ", h, secreto), false);
  assert.equal(firmaSvixValida(cuerpo, { ...h, "svix-timestamp": String(Number(ts) - 600) }, secreto), false);
});

"use strict";
// Almacenamiento: Postgres si existe DATABASE_URL; si no, memoria (pruebas y desarrollo local).
// Nunca se guardan datos de tarjeta: los textos pasan por sanitizar() antes de llegar aquí.

const HISTORIAL = 10;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS conversaciones (
  id TEXT PRIMARY KEY,
  telefono TEXT,
  nombre TEXT,
  origen TEXT NOT NULL DEFAULT 'whatsapp',
  estado TEXT NOT NULL DEFAULT 'bot',          -- bot | humano
  pasada_a_persona BOOLEAN NOT NULL DEFAULT FALSE,
  veces_pasada INT NOT NULL DEFAULT 0,
  aviso_ia_enviado BOOLEAN NOT NULL DEFAULT FALSE,
  ultimo_entrante TIMESTAMPTZ,
  creada TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversaciones_telefono ON conversaciones (telefono);
CREATE TABLE IF NOT EXISTS mensajes (
  id BIGSERIAL PRIMARY KEY,
  conversacion_id TEXT NOT NULL REFERENCES conversaciones(id) ON DELETE CASCADE,
  rol TEXT NOT NULL,
  texto TEXT NOT NULL,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mensajes_conv ON mensajes (conversacion_id, id DESC);
CREATE TABLE IF NOT EXISTS contactos (
  telefono TEXT PRIMARY KEY,
  nombre TEXT,
  acepta_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  baja BOOLEAN NOT NULL DEFAULT FALSE,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS eventos (
  id TEXT PRIMARY KEY,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

function memoria() {
  const conv = new Map(), msgs = new Map(), contactos = new Map(), eventos = new Set();
  return {
    async iniciar() {},
    async eventoNuevo(id) { if (eventos.has(id)) return false; eventos.add(id); return true; },
    async conversacion(id) { return conv.get(id) || null; },
    async conversacionPorTelefono(tel) {
      return [...conv.values()].filter((c) => c.telefono === tel).sort((a, b) => b.actualizada - a.actualizada)[0] || null;
    },
    async guardarConversacion(c) {
      const previa = conv.get(c.id) || {
        estado: "bot", pasada_a_persona: false, veces_pasada: 0, aviso_ia_enviado: false, origen: "whatsapp", creada: new Date(),
      };
      const nueva = { ...previa, ...c, actualizada: new Date() };
      conv.set(c.id, nueva);
      return nueva;
    },
    async agregarMensaje(id, rol, texto) {
      const l = msgs.get(id) || [];
      l.push({ rol, texto, fecha: new Date() });
      msgs.set(id, l.slice(-HISTORIAL));
    },
    async historial(id) { return (msgs.get(id) || []).slice(-HISTORIAL); },
    async contacto(tel) { return contactos.get(tel) || null; },
    async guardarContacto(c) {
      const definidos = Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== null));
      contactos.set(c.telefono, { acepta_whatsapp: false, baja: false, ...(contactos.get(c.telefono) || {}), ...definidos });
    },
    async registro(limite = 100) {
      return [...conv.values()].sort((a, b) => b.creada - a.creada).slice(0, limite)
        .map(({ id, telefono, nombre, origen, estado, pasada_a_persona, creada, actualizada }) =>
          ({ id, telefono, nombre, origen, estado, pasada_a_persona, creada, actualizada }));
    },
  };
}

function postgres(url) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: url, max: 5 });
  const q = (sql, p) => pool.query(sql, p);
  const COLS = ["telefono", "nombre", "origen", "estado", "pasada_a_persona", "veces_pasada", "aviso_ia_enviado", "ultimo_entrante"];
  return {
    async iniciar() { await q(ESQUEMA); },
    async eventoNuevo(id) {
      const r = await q("INSERT INTO eventos (id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
      return r.rowCount === 1;
    },
    async conversacion(id) { return (await q("SELECT * FROM conversaciones WHERE id=$1", [id])).rows[0] || null; },
    async conversacionPorTelefono(tel) {
      return (await q("SELECT * FROM conversaciones WHERE telefono=$1 ORDER BY actualizada DESC LIMIT 1", [tel])).rows[0] || null;
    },
    async guardarConversacion(c) {
      const campos = COLS.filter((k) => c[k] !== undefined);
      const valores = campos.map((k) => c[k]);
      const sql = `INSERT INTO conversaciones (id${campos.map((k) => "," + k).join("")})
        VALUES ($1${campos.map((_, i) => ",$" + (i + 2)).join("")})
        ON CONFLICT (id) DO UPDATE SET actualizada=now()${campos.map((k) => `,${k}=EXCLUDED.${k}`).join("")}
        RETURNING *`;
      return (await q(sql, [c.id, ...valores])).rows[0];
    },
    async agregarMensaje(id, rol, texto) {
      await q("INSERT INTO mensajes (conversacion_id, rol, texto) VALUES ($1,$2,$3)", [id, rol, texto]);
      // Solo se conserva el historial corto.
      await q(`DELETE FROM mensajes WHERE conversacion_id=$1 AND id NOT IN
        (SELECT id FROM mensajes WHERE conversacion_id=$1 ORDER BY id DESC LIMIT ${HISTORIAL})`, [id]);
    },
    async historial(id) {
      const r = await q(`SELECT rol, texto FROM mensajes WHERE conversacion_id=$1 ORDER BY id DESC LIMIT ${HISTORIAL}`, [id]);
      return r.rows.reverse();
    },
    async contacto(tel) { return (await q("SELECT * FROM contactos WHERE telefono=$1", [tel])).rows[0] || null; },
    async guardarContacto(c) {
      await q(`INSERT INTO contactos (telefono, nombre, acepta_whatsapp, baja) VALUES ($1,$2,COALESCE($3,FALSE),COALESCE($4,FALSE))
        ON CONFLICT (telefono) DO UPDATE SET actualizado=now(),
          nombre=COALESCE($2, contactos.nombre),
          acepta_whatsapp=COALESCE($3, contactos.acepta_whatsapp),
          baja=COALESCE($4, contactos.baja)`,
      [c.telefono, c.nombre ?? null, c.acepta_whatsapp ?? null, c.baja ?? null]);
    },
    async registro(limite = 100) {
      return (await q(`SELECT id, telefono, nombre, origen, estado, pasada_a_persona, creada, actualizada
        FROM conversaciones ORDER BY creada DESC LIMIT $1`, [limite])).rows;
    },
  };
}

const db = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : memoria();
module.exports = db;
module.exports.memoria = memoria;

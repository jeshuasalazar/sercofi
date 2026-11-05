# SERCOFI · Sitio web

Sitio de SERCOFI Servicios Contables y Fiscales: landing page con diagnóstico gratuito para captar prospectos, más el aviso de privacidad, los términos y la política de cookies.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `index.html` | Página principal y cuestionario de diagnóstico |
| `aviso-privacidad.html`, `terminos.html`, `cookies.html` | Documentos legales |
| `assets/css`, `assets/js`, `assets/img` | Estilos, scripts e imágenes optimizadas |
| `server.js` | Servidor estático sin dependencias para Railway |

## Correr en local

```bash
npm start
```

Abre http://localhost:3000

## Despliegue en Railway

1. En Railway: **New Project → Deploy from GitHub repo → jeshuasalazar/sercofi**.
2. Railway detecta Node y ejecuta `npm start`. No hay que configurar variables: el puerto lo asigna Railway.
3. En **Settings → Networking**, genera un dominio o conecta `www.sercofi.mx`.
4. Opcional: en **Settings → Deploy → Healthcheck Path** usa `/healthz`.

Cada `git push` a `main` vuelve a desplegar el sitio.

## Formularios

El diagnóstico se envía con EmailJS usando el servicio y las plantillas ya configurados (`assets/js/diagnostico.js`, objeto `CONFIG`).
Para probar sin enviar correos reales, ejecuta en la consola del navegador `window.SERCOFI_DIAG_DEMO = true` antes de enviar.

## Agente de WhatsApp (carpeta `agente/`)

- `POST /api/whatsapp/webhook`: recibe mensajes de Zernio (firma `X-Zernio-Signature`, secreto `ZERNIO_WEBHOOK_SECRET`).
- `POST /api/webhooks/formularios`: recibe el diagnóstico del navegador y lo reenvía firmado (HMAC, `AGENTE_WEBHOOK_SECRETO`) a `AGENTE_WEBHOOK_URL`.
- `POST /api/agente`: recibe el formulario firmado; escribe al cliente solo si aceptó WhatsApp y siempre avisa al equipo.
- `GET /api/agente/registro`: registro de conversaciones (`Authorization: Bearer $AGENTE_ADMIN_TOKEN`).
- Paso a persona: el bot avisa al WhatsApp de `AVISO_WHATSAPP_DUENO` y deja de contestar. La persona contesta desde la bandeja de Zernio y, para regresar la conversación al bot, escribe al número del asistente: `CERRAR <número del cliente>`.
- Pruebas: `npm test` (las de conducta necesitan `OPENAI_API_KEY`).

Variables: `ZERNIO_API_KEY`, `ZERNIO_ACCOUNT_ID`, `ZERNIO_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `AGENTE_MODELO`, `AGENTE_WEBHOOK_URL`, `AGENTE_WEBHOOK_SECRETO`, `AGENTE_ADMIN_TOKEN`, `AVISO_WHATSAPP_DUENO`, `PLANTILLA_BIENVENIDA`, `PLANTILLA_AVISO_DUENO`, `PLANTILLA_IDIOMA`, `DATABASE_URL`.

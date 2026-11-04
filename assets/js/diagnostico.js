/*
 * Diagnóstico gratuito – SERCOFI
 * Cuestionario por pasos que califica al prospecto (caliente / tibio / frío)
 * y lo envía con EmailJS usando la misma cuenta y plantilla del formulario de contacto.
 *
 * Los módulos del sitio se insertan con innerHTML, por lo que los <script> dentro
 * del módulo no se ejecutan. Por eso este archivo se carga una sola vez en index.html
 * y detecta cuándo aparece el formulario.
 */
(function () {
  "use strict";

  var CONFIG = {
    emailjsPublicKey: "XMa5rvTXQX2Y8MG5H",
    emailjsService: "service_y61rq75",
    templateEmpresa: "template_vdp7az2", // correo a contacto@sercofi.mx
    templateCliente: "template_gk8r1xn", // acuse de recibo al prospecto
    whatsapp: "525539887605",            // 55-3988-7605 con lada de México
    maxServiciosPts: 4,
    umbralCaliente: 14,
    umbralTibio: 8
  };

  var TOTAL_STEPS = 6;

  function $(root, sel) { return root.querySelector(sel); }
  function $$(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  function init(card) {
    if (card.dataset.sdReady) return;
    card.dataset.sdReady = "1";

    var form = $(card, ".sd-form");
    var steps = $$(card, ".sd-step");
    var bar = $(card, ".sd-progress-bar");
    var label = $(card, ".sd-step-label");
    var err = $(card, ".sd-error");
    var btnPrev = $(card, '[data-sd="prev"]');
    var btnNext = $(card, '[data-sd="next"]');
    var btnSubmit = $(card, '[data-sd="submit"]');
    var current = 1;

    function show(n) {
      current = n;
      steps.forEach(function (s) { s.hidden = Number(s.dataset.step) !== n; });
      bar.style.width = ((n - 1) / TOTAL_STEPS * 100 + 100 / TOTAL_STEPS) + "%";
      label.innerHTML = "<b>Paso " + n + "</b> de " + TOTAL_STEPS;
      btnPrev.setAttribute("aria-hidden", n === 1 ? "true" : "false");
      btnPrev.disabled = n === 1;
      btnNext.hidden = n === TOTAL_STEPS;
      btnSubmit.hidden = n !== TOTAL_STEPS;
      err.textContent = "";
    }

    function validate(n) {
      var step = $(form, '.sd-step[data-step="' + n + '"]');
      $$(step, ".sd-invalid").forEach(function (el) { el.classList.remove("sd-invalid"); });

      // Grupos de radio obligatorios
      var groups = {};
      $$(step, 'input[type="radio"][required]').forEach(function (r) { groups[r.name] = true; });
      for (var name in groups) {
        if (!$(step, 'input[name="' + name + '"]:checked')) return fail("Elige una opción para continuar.");
      }
      // Paso 3: al menos un servicio
      if (n === 3 && !$(step, 'input[name="servicios"]:checked')) return fail("Elige al menos una opción.");

      // Campos de texto obligatorios
      var fields = $$(step, "input[required]:not([type=radio]):not([type=checkbox])");
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        f.value = f.value.trim();
        if (!f.checkValidity() || (f.name === "telefono" && f.value.replace(/\D/g, "").length < 10)) {
          f.classList.add("sd-invalid");
          f.focus();
          var msg = {
            nombre: "Escribe tu nombre.",
            telefono: "Escribe un teléfono de al menos 10 dígitos.",
            email: "Escribe un correo válido."
          }[f.name] || "Completa este campo.";
          return fail(msg);
        }
      }
      var priv = $(step, 'input[name="privacidad"]');
      if (priv && !priv.checked) return fail("Para continuar acepta el Aviso de Privacidad.");
      return true;
    }

    function fail(msg) { err.textContent = msg; return false; }

    btnNext.addEventListener("click", function () {
      if (validate(current)) { show(current + 1); scrollTop(); }
    });
    btnPrev.addEventListener("click", function () {
      if (current > 1) { show(current - 1); scrollTop(); }
    });
    // Avance automático en pasos de una sola pregunta
    form.addEventListener("change", function (e) {
      err.textContent = "";
      if (e.target.type !== "radio") return;
      var step = e.target.closest(".sd-step");
      var n = Number(step.dataset.step);
      if (n === 1 || n === 5 || n === TOTAL_STEPS) return; // tienen campos extra
      var allAnswered = $$(step, 'input[type="radio"][required]').every(function (r) {
        return $(step, 'input[name="' + r.name + '"]:checked');
      });
      if (allAnswered) setTimeout(function () { if (current === n) { show(n + 1); scrollTop(); } }, 250);
    });
    form.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA" && current < TOTAL_STEPS) {
        e.preventDefault();
        btnNext.click();
      }
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate(current)) return;
      if (form.elements.empresa_web.value) return; // bot

      var data = collect(form);
      var lead = score(form);
      btnSubmit.disabled = true;
      btnSubmit.textContent = "Enviando…";

      send(data, lead).then(function () {
        showResult(card, data, lead);
      }).catch(function (error) {
        console.error("Diagnóstico: error al enviar", error);
        btnSubmit.disabled = false;
        btnSubmit.textContent = "Recibir mi diagnóstico";
        err.innerHTML = 'No pudimos enviar tus datos. Intenta de nuevo o <a href="' +
          waLink(data) + '" target="_blank" rel="noopener">escríbenos por WhatsApp</a>.';
      });
    });

    function scrollTop() {
      var y = card.getBoundingClientRect().top + window.pageYOffset - 90;
      if (window.pageYOffset > y) window.scrollTo({ top: y, behavior: "smooth" });
    }

    show(1);
  }

  function collect(form) {
    var f = form.elements;
    function val(name) { var el = form.querySelector('[name="' + name + '"]:checked') || f[name]; return el ? el.value.trim() : ""; }
    return {
      regimen: val("regimen"),
      giro: val("giro"),
      empleados: val("empleados"),
      facturacion: val("facturacion"),
      servicios: $$(form, 'input[name="servicios"]:checked').map(function (c) { return c.value; }),
      contador: val("contador"),
      corriente: val("corriente"),
      urgencia: val("urgencia"),
      mensaje: val("mensaje"),
      nombre: val("nombre"),
      telefono: val("telefono"),
      email: val("email"),
      ciudad: val("ciudad"),
      canal: val("canal")
    };
  }

  function score(form) {
    var pts = 0, servicios = 0;
    $$(form, "input[data-pts]:checked").forEach(function (el) {
      var p = Number(el.dataset.pts) || 0;
      if (el.name === "servicios") servicios += p; else pts += p;
    });
    pts += Math.min(servicios, CONFIG.maxServiciosPts);
    var nivel = pts >= CONFIG.umbralCaliente ? "CALIENTE" : pts >= CONFIG.umbralTibio ? "TIBIO" : "FRÍO";
    var accion = {
      "CALIENTE": "Contactar HOY por " ,
      "TIBIO": "Enviar información y dar seguimiento en 2–3 días por ",
      "FRÍO": "Enviar contenido útil y dar seguimiento en 2 semanas por "
    }[nivel];
    return { puntos: pts, nivel: nivel, accion: accion };
  }

  function buildMessage(d, lead) {
    return [
      "CALIFICACIÓN: " + lead.nivel + " (" + lead.puntos + " pts)",
      "Siguiente paso: " + lead.accion + d.canal,
      "",
      "— Perfil —",
      "Régimen: " + d.regimen,
      "Giro: " + (d.giro || "—"),
      "Empleados: " + d.empleados,
      "Facturación anual: " + d.facturacion,
      "",
      "— Necesidad —",
      "Servicios: " + d.servicios.join(", "),
      "Contador actual: " + d.contador,
      "Al corriente: " + d.corriente,
      "Urgencia: " + d.urgencia,
      "",
      "— Contacto —",
      "Ciudad: " + (d.ciudad || "—"),
      "Prefiere: " + d.canal,
      "",
      "Comentario: " + (d.mensaje || "—")
    ].join("\n");
  }

  function send(d, lead) {
    var paramsEmpresa = {
      name: d.nombre,
      email: d.email,
      phone: d.telefono,
      title: "[" + lead.nivel + " · " + lead.puntos + " pts] Diagnóstico web – " + d.nombre,
      interes: d.servicios.join(", "),
      message: buildMessage(d, lead)
    };
    var paramsCliente = { name: d.nombre, email: d.email, title: "Recibimos tu diagnóstico" };

    // Modo de prueba: no envía correos reales
    if (window.SERCOFI_DIAG_DEMO) {
      window.__sdLastPayload = { empresa: paramsEmpresa, cliente: paramsCliente };
      console.info("[Diagnóstico DEMO] No se enviaron correos.", window.__sdLastPayload);
      return new Promise(function (r) { setTimeout(r, 600); });
    }
    if (!window.emailjs) return Promise.reject(new Error("EmailJS no está cargado"));

    return emailjs.send(CONFIG.emailjsService, CONFIG.templateEmpresa, paramsEmpresa, CONFIG.emailjsPublicKey)
      .then(function () {
        // El acuse al cliente no debe bloquear el éxito si falla
        return emailjs.send(CONFIG.emailjsService, CONFIG.templateCliente, paramsCliente, CONFIG.emailjsPublicKey)
          .catch(function (e) { console.warn("Diagnóstico: no se envió el acuse", e); });
      })
      .then(function () {
        if (typeof window.gtag === "function") {
          window.gtag("event", "generate_lead", { lead_level: lead.nivel, value: lead.puntos });
        }
        if (typeof window.fbq === "function") window.fbq("track", "Lead");
      });
  }

  function waLink(d) {
    var text = "Hola SERCOFI, soy " + (d.nombre || "") + ". Acabo de llenar el diagnóstico en su sitio" +
      (d.servicios && d.servicios.length ? " y me interesa: " + d.servicios.join(", ") : "") + ".";
    return "https://wa.me/" + CONFIG.whatsapp + "?text=" + encodeURIComponent(text);
  }

  function showResult(card, d, lead) {
    $(card, ".sd-form").hidden = true;
    $(card, ".sd-head").hidden = true;
    var res = $(card, ".sd-result");
    var nombre = d.nombre.split(" ")[0];
    var cuando = lead.nivel === "CALIENTE" ? "hoy mismo" : "en menos de 24 horas hábiles";
    $(res, ".sd-result-title").textContent = "¡Listo, " + nombre + "!";
    $(res, ".sd-result-text").textContent =
      "Recibimos tu información. Un contador de SERCOFI revisará tu caso y te contactará " + cuando +
      " por " + d.canal.toLowerCase() + ". Si prefieres adelantarte, escríbenos ahora.";
    $(res, ".sd-btn--wa").href = waLink(d);
    res.hidden = false;
    res.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Inicializa cuando el módulo aparece en la página
  function scan() { $$(document, "#diagnostico .sd-card").forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });

  window.SercofiDiagnostico = { config: CONFIG, init: scan };
})();

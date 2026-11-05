/*
 * Boletín fiscal · SERCOFI
 * Lee assets/data/boletin.json y lo muestra en:
 *  - boletin.html  (página completa: destacada, filtros, búsqueda, agenda, suscripción)
 *  - index.html    (avance con la nota destacada y las más recientes)
 * Para publicar una nota nueva solo hay que agregarla al JSON.
 */
(function () {
  "use strict";

  var DATA_URL = "assets/data/boletin.json";
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  var ICON = {
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
    wa: '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>'
  };

  var listEl = document.getElementById("bf-list");
  var homeEl = document.getElementById("bf-home");
  if (!listEl && !homeEl) return;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function parse(d) { var p = d.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmtLong(d) { var x = parse(d); return x.getDate() + " de " + x.toLocaleDateString("es-MX", { month: "long" }) + " de " + x.getFullYear(); }
  function daysFrom(d) { return Math.round((parse(d) - today) / 864e5); }
  function isNew(n) { var a = -daysFrom(n.fecha); return a >= 0 && a <= 7; }
  function norm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function pageUrl(id) { return "boletin.html?nota=" + encodeURIComponent(id); }
  function absUrl(id) { return location.origin + "/boletin?nota=" + encodeURIComponent(id); }

  function tag(data, cat) { return '<span class="bf-tag" data-cat="' + esc(cat) + '">' + esc(data.categorias[cat] || cat) + "</span>"; }

  function card(data, n, i, asLink) {
    var x = parse(n.fecha);
    var inner =
      (isNew(n) ? '<span class="bf-new">Nuevo</span>' : "") +
      '<div class="bf-date"><b>' + x.getDate() + "</b><span>" + MESES[x.getMonth()] + "</span></div>" +
      "<div>" + '<div class="bf-meta">' + tag(data, n.categoria) + "</div>" +
      "<h3>" + esc(n.titulo) + "</h3><p>" + esc(n.resumen) + "</p></div>" +
      '<span class="bf-card__go" aria-hidden="true">' + ICON.arrow + "</span>";
    var style = ' style="animation-delay:' + i * 60 + 'ms"';
    return asLink
      ? '<a class="bf-card bf-anim" href="' + pageUrl(n.id) + '"' + style + ">" + inner + "</a>"
      : '<button type="button" class="bf-card bf-anim" data-id="' + esc(n.id) + '"' + style + ">" + inner + "</button>";
  }

  function featured(data, n, asLink, headingTag) {
    var h = headingTag || "h2";
    var action = asLink
      ? '<a class="btn btn--primary magnetic" href="' + pageUrl(n.id) + '">Leer la nota ' + ICON.arrow.replace("<svg", '<svg class="arrow"') + "</a>"
      : '<button type="button" class="btn btn--primary" data-id="' + esc(n.id) + '">Leer la nota ' + ICON.arrow.replace("<svg", '<svg class="arrow"') + "</button>";
    return (
      '<article class="bf-featured">' +
      '<div class="bf-featured__bg" aria-hidden="true"></div>' +
      '<div class="bf-featured__body">' +
      '<span class="bf-featured__label">Nota destacada</span>' +
      '<div class="bf-meta">' + tag(data, n.categoria) + "<span>" + fmtLong(n.fecha) + "</span></div>" +
      "<" + h + ">" + esc(n.titulo) + "</" + h + "><p>" + esc(n.resumen) + "</p>" +
      '<div class="bf-featured__actions">' + action +
      '<a class="btn btn--ghost" href="index.html#diagnostico">¿Te afecta? Te ayudamos</a></div>' +
      "</div>" +
      (n.kpis && n.kpis.length
        ? '<div class="bf-featured__side">' + n.kpis.map(function (k) {
            return '<div class="bf-kpi"><span class="bf-kpi__num">' + esc(k.valor) + '</span><span class="bf-kpi__txt">' + esc(k.texto) + "</span></div>";
          }).join("") + "</div>"
        : "") +
      "</article>"
    );
  }

  function load() {
    return fetch(DATA_URL, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (data) {
      data.noticias.sort(function (a, b) { return b.fecha.localeCompare(a.fecha) || (b.destacada ? 1 : 0) - (a.destacada ? 1 : 0); });
      return data;
    });
  }

  function errorBox(el) {
    el.innerHTML = '<div class="bf-empty">No pudimos cargar el boletín. Recarga la página o escríbenos por <a href="https://wa.me/525539887605" target="_blank" rel="noopener">WhatsApp</a>.</div>';
  }

  /* ================= Home preview ================= */
  if (homeEl) {
    load().then(function (data) {
      var top = data.noticias.filter(function (n) { return n.destacada; })[0] || data.noticias[0];
      var rest = data.noticias.filter(function (n) { return n !== top; }).slice(0, 3);
      homeEl.innerHTML =
        '<div class="bf-home__grid">' + featured(data, top, true, "h3") +
        '<div class="bf-list">' + rest.map(function (n, i) { return card(data, n, i, true); }).join("") + "</div></div>";
      var up = document.getElementById("bf-home-updated");
      if (up) up.textContent = "Actualizado el " + fmtLong(data.actualizado);
    }).catch(function () { errorBox(homeEl); });
    return;
  }

  /* ================= Full page ================= */
  var featEl = document.getElementById("bf-featured");
  var chipsEl = document.getElementById("bf-chips");
  var qEl = document.getElementById("bf-q");
  var agendaEl = document.getElementById("bf-agenda");
  var dlg = document.getElementById("bf-dialog");
  var dlgContent = document.getElementById("bf-dialog-content");
  var state = { cat: "todas", q: "" };
  var DATA = null;

  load().then(function (data) {
    DATA = data;
    document.getElementById("bf-updated").textContent = "Actualizado el " + fmtLong(data.actualizado);

    var top = data.noticias.filter(function (n) { return n.destacada; })[0] || data.noticias[0];
    featEl.innerHTML = featured(data, top, false, "h2");

    // Chips
    var counts = {};
    data.noticias.forEach(function (n) { counts[n.categoria] = (counts[n.categoria] || 0) + 1; });
    var chips = [["todas", "Todas", data.noticias.length]].concat(
      Object.keys(data.categorias).filter(function (k) { return counts[k]; }).map(function (k) { return [k, data.categorias[k], counts[k]]; })
    );
    chipsEl.innerHTML = chips.map(function (c) {
      return '<button type="button" class="bf-chip" data-cat="' + c[0] + '" aria-pressed="' + (c[0] === "todas") + '">' + esc(c[1]) + " · " + c[2] + "</button>";
    }).join("");

    renderList();
    renderAgenda(data.agenda || []);
    injectSchema(data);

    var id = new URLSearchParams(location.search).get("nota");
    if (id) openNote(id, true);
  }).catch(function () { errorBox(listEl); featEl.innerHTML = ""; });

  function renderList() {
    var q = norm(state.q.trim());
    var items = DATA.noticias.filter(function (n) {
      if (state.cat !== "todas" && n.categoria !== state.cat) return false;
      if (!q) return true;
      return norm([n.titulo, n.resumen, (n.puntos || []).join(" "), n.impacto, DATA.categorias[n.categoria]].join(" ")).indexOf(q) !== -1;
    });
    listEl.innerHTML = items.length
      ? items.map(function (n, i) { return card(DATA, n, i, false); }).join("")
      : '<div class="bf-empty">No encontramos notas con esa búsqueda. Prueba con otra palabra o <a href="index.html#diagnostico">pregúntanos directamente</a>.</div>';
  }

  function renderAgenda(items) {
    var shown = items.filter(function (a) { return daysFrom(a.fin || a.fecha) >= -3; }).slice(0, 6);
    if (!shown.length) { agendaEl.innerHTML = '<li><span>Próximamente publicaremos las siguientes fechas.</span></li>'; return; }
    agendaEl.innerHTML = shown.map(function (a) {
      var d = parse(a.fecha), left = daysFrom(a.fecha), end = a.fin ? daysFrom(a.fin) : left;
      var cls = end < 0 ? "is-past" : left <= 7 ? "is-soon" : "";
      var when = end < 0 ? "Ya pasó" : left <= 0 ? "Hoy" : left === 1 ? "Mañana" : "En " + left + " días";
      if (a.fin && left <= 0 && end >= 0) when = "En curso";
      return '<li class="' + cls + '"><span class="d"><b>' + d.getDate() + "</b><small>" + MESES[d.getMonth()] + "</small></span>" +
        "<div><strong>" + esc(a.titulo) + "</strong><span>" + esc(a.detalle) + "</span><em>" + when + "</em></div></li>";
    }).join("");
  }

  function injectSchema(data) {
    var s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: data.noticias.map(function (n, i) {
        return {
          "@type": "ListItem", position: i + 1,
          item: { "@type": "NewsArticle", headline: n.titulo, description: n.resumen, datePublished: n.fecha, url: absUrl(n.id),
            publisher: { "@type": "Organization", name: "SERCOFI" } }
        };
      })
    });
    document.head.appendChild(s);
  }

  function openNote(id, fromUrl) {
    var n = DATA && DATA.noticias.filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    var url = absUrl(n.id);
    var wa = "https://wa.me/?text=" + encodeURIComponent(n.titulo + " — Boletín fiscal SERCOFI: " + url);
    dlgContent.innerHTML =
      '<div class="bf-dialog__head">' +
      '<button type="button" class="bf-dialog__close" data-close aria-label="Cerrar">' + ICON.close + "</button>" +
      '<div class="bf-meta">' + tag(DATA, n.categoria) + "<span>" + fmtLong(n.fecha) + "</span></div>" +
      '<h2 id="bf-d-title">' + esc(n.titulo) + '</h2><p class="bf-dialog__lead">' + esc(n.resumen) + "</p></div>" +
      '<div class="bf-dialog__body">' +
      (n.puntos && n.puntos.length ? "<h3>Lo importante</h3><ol class=\"bf-points\">" + n.puntos.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ol>" : "") +
      (n.impacto ? '<div class="bf-impact"><strong>' + ICON.bulb + "Qué significa para ti</strong>" + esc(n.impacto) + "</div>" : "") +
      "<h3>Fuentes</h3><ul class=\"bf-fuentes\">" + (n.fuentes || []).map(function (f) {
        return '<li><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + ICON.ext + "<span>" + esc(f.nombre) + "</span></a></li>";
      }).join("") + "</ul>" +
      '<div class="bf-dialog__foot">' +
      '<a class="btn btn--primary" href="index.html#diagnostico">Quiero asesoría sobre esto</a>' +
      '<a class="btn btn--ghost" href="' + wa + '" target="_blank" rel="noopener">' + ICON.wa + " Compartir</a>" +
      '<button type="button" class="btn btn--ghost" data-copy="' + esc(url) + '">' + ICON.link + " Copiar enlace</button>" +
      '<span class="bf-copied" aria-live="polite"></span></div></div>';

    if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else { dlg.setAttribute("open", ""); }
    dlgContent.scrollTop = 0;
    if (!fromUrl || new URLSearchParams(location.search).get("nota") !== id) {
      history.pushState({ nota: id }, "", "?nota=" + encodeURIComponent(id));
    }
    document.title = n.titulo + " | Boletín fiscal SERCOFI";
  }

  function closeNote(skipHistory) {
    if (dlg.open) dlg.close();
    document.title = "Boletín fiscal | Noticias del SAT, DOF y contabilidad | SERCOFI";
    if (!skipHistory && new URLSearchParams(location.search).get("nota")) history.pushState({}, "", location.pathname);
  }

  // Events
  document.addEventListener("click", function (e) {
    var open = e.target.closest("[data-id]");
    if (open && DATA) { openNote(open.getAttribute("data-id")); return; }
    var chip = e.target.closest(".bf-chip");
    if (chip) {
      state.cat = chip.dataset.cat;
      document.querySelectorAll(".bf-chip").forEach(function (c) { c.setAttribute("aria-pressed", c === chip); });
      renderList();
      return;
    }
    if (e.target.closest("[data-close]")) { closeNote(); return; }
    var copy = e.target.closest("[data-copy]");
    if (copy) {
      var msg = dlgContent.querySelector(".bf-copied");
      var done = function () { msg.textContent = "Enlace copiado"; msg.classList.add("is-on"); setTimeout(function () { msg.classList.remove("is-on"); }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(copy.dataset.copy).then(done, function () { prompt("Copia el enlace:", copy.dataset.copy); });
      else prompt("Copia el enlace:", copy.dataset.copy);
    }
  });
  // Cerrar al hacer clic fuera del contenido
  dlg.addEventListener("click", function (e) { if (e.target === dlg) closeNote(); });
  dlg.addEventListener("cancel", function (e) { e.preventDefault(); closeNote(); });
  window.addEventListener("popstate", function () {
    var id = new URLSearchParams(location.search).get("nota");
    if (id) openNote(id, true); else closeNote(true);
  });

  var t;
  qEl.addEventListener("input", function () {
    clearTimeout(t);
    t = setTimeout(function () { state.q = qEl.value; renderList(); }, 150);
  });

  /* ================= Suscripción ================= */
  var sub = document.getElementById("bf-sub");
  if (sub) {
    var msg = sub.querySelector(".bf-sub__msg");
    sub.addEventListener("submit", function (e) {
      e.preventDefault();
      msg.className = "bf-sub__msg";
      if (sub.empresa_web.value) return;
      var nombre = sub.nombre.value.trim(), email = sub.email.value.trim();
      if (!nombre) { msg.textContent = "Escribe tu nombre."; msg.classList.add("err"); sub.nombre.focus(); return; }
      if (!sub.email.checkValidity() || !email) { msg.textContent = "Escribe un correo válido."; msg.classList.add("err"); sub.email.focus(); return; }
      if (!sub.acepto.checked) { msg.textContent = "Acepta el aviso de privacidad para suscribirte."; msg.classList.add("err"); return; }

      var btn = sub.querySelector("button");
      btn.disabled = true; btn.textContent = "Enviando…";
      var p = window.SERCOFI_DIAG_DEMO
        ? new Promise(function (r) { window.__bfLastSub = { nombre: nombre, email: email }; setTimeout(r, 500); })
        : fetch("/api/boletin/suscribir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre: nombre, email: email, acepto: true, empresa_web: sub.empresa_web.value })
          }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); });
      p.then(function () {
        sub.reset();
        msg.textContent = "¡Casi listo! Te mandamos un correo para confirmar tu suscripción.";
        msg.classList.add("ok");
      }).catch(function () {
        msg.textContent = "No pudimos registrarte. Intenta de nuevo o escríbenos a contacto@sercofi.mx.";
        msg.classList.add("err");
      }).then(function () { btn.disabled = false; btn.textContent = "Suscribirme"; });
    });
  }
})();

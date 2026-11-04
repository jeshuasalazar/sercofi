/* SERCOFI · interacciones y motion */
(function () {
  "use strict";

  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------- Split text into words ---------- */
  $$("[data-split]").forEach(function (el) {
    var i = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var parts = child.textContent.split(/(\s+)/);
          var frag = document.createDocumentFragment();
          parts.forEach(function (p) {
            if (!p) return;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(" ")); return; }
            var w = document.createElement("span");
            w.className = "w";
            var inner = document.createElement("span");
            inner.style.setProperty("--i", i++);
            inner.textContent = p;
            w.appendChild(inner);
            frag.appendChild(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && child.tagName.toLowerCase() !== "svg") {
          walk(child);
        }
      });
    })(el);
  });

  /* ---------- Start (sin pantalla de carga: el contenido aparece de inmediato) ---------- */
  var started = false;
  function start() {
    if (started) return;
    started = true;
    root.classList.add("is-loaded");
    requestAnimationFrame(observeReveals);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  /* ---------- Reveal on scroll ---------- */
  function observeReveals() {
    var items = $$(".reveal, .split");
    if (!("IntersectionObserver" in window)) { items.forEach(function (el) { el.classList.add("is-in"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });
    // Respaldo: si el usuario salta rápido (ancla, tecla Fin), revela lo que ya quedó arriba
    pendingReveal = items;
    catchUp();
  }
  var pendingReveal = [];
  function catchUp() {
    if (!pendingReveal.length) return;
    var vh = window.innerHeight;
    pendingReveal = pendingReveal.filter(function (el) {
      if (el.classList.contains("is-in")) return false;
      if (el.getBoundingClientRect().top < vh * 0.92) { el.classList.add("is-in"); return false; }
      return true;
    });
  }

  /* ---------- Nav ---------- */
  var nav = $("#nav");
  var toggle = $(".nav__toggle");
  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open);
    toggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
  });
  $$(".nav__links a").forEach(function (a) {
    a.addEventListener("click", function () {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
  document.addEventListener("click", function (e) {
    if (nav.classList.contains("is-open") && !nav.contains(e.target)) { nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); }
  });

  // Enlace activo según la sección visible
  var links = $$(".nav__links a");
  if ("IntersectionObserver" in window) {
    var secIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["servicios", "proceso", "nosotros", "diagnostico"].forEach(function (id) { var s = document.getElementById(id); if (s) secIO.observe(s); });
  }

  /* ---------- Rotating words ---------- */
  var rot = $(".rotator");
  if (rot) {
    var words = $$("span", rot), w = 0;
    setInterval(function () {
      var cur = words[w];
      w = (w + 1) % words.length;
      var next = words[w];
      cur.classList.remove("is-in"); cur.classList.add("is-out");
      next.classList.remove("is-out"); next.classList.add("is-in");
      setTimeout(function () { cur.classList.remove("is-out"); }, 650);
    }, 2600);
  }

  /* ---------- Marquee: duplicate content for seamless loop ---------- */
  var track = $(".marquee__track");
  if (track) track.innerHTML += track.innerHTML;

  /* ---------- Scroll-driven effects ---------- */
  var progress = $(".progress");
  var fab = $(".wa-fab");
  var parallax = reduce ? [] : $$("[data-parallax]");
  var steps = $("#steps");
  var stepEls = steps ? $$(".step", steps) : [];
  var line = steps ? $(".process__line i", steps) : null;
  var ticking = false;

  function onScroll() {
    var y = window.pageYOffset;
    var vh = window.innerHeight;
    var max = document.documentElement.scrollHeight - vh;

    progress.style.transform = "scaleX(" + (max > 0 ? y / max : 0) + ")";
    catchUp();
    nav.classList.toggle("is-scrolled", y > 24);
    fab.classList.toggle("is-visible", y > 500);

    parallax.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) return;
      var center = r.top + r.height / 2 - vh / 2;
      el.style.translate = "0 " + (center * Number(el.dataset.parallax)).toFixed(1) + "px";
    });

    if (steps) {
      var sr = steps.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, (vh * 0.75 - sr.top) / (sr.height + vh * 0.25)));
      if (reduce) p = sr.top < vh * 0.8 ? 1 : 0;
      if (line) line.style.transform = "scaleX(" + p + ")";
      stepEls.forEach(function (s, i) { s.classList.toggle("is-lit", p >= i / Math.max(1, stepEls.length - 1) - 0.02); });
    }
    ticking = false;
  }
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* ---------- Pointer effects (desktop only) ---------- */
  if (finePointer && !reduce) {
    // Tilt + spotlight
    $$("[data-tilt]").forEach(function (el) {
      var strength = el.classList.contains("hero__frame") ? 6 : 5;
      el.addEventListener("mouseenter", function () { el.style.transition = "transform .25s ease-out, box-shadow .5s, border-color .3s"; });
      el.addEventListener("mousemove", function (e) {
        var r = el.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        el.style.setProperty("--mx", px * 100 + "%");
        el.style.setProperty("--my", py * 100 + "%");
        el.style.transform = "perspective(900px) rotateX(" + ((0.5 - py) * strength).toFixed(2) + "deg) rotateY(" + ((px - 0.5) * strength).toFixed(2) + "deg) translateY(-6px)";
      });
      el.addEventListener("mouseleave", function () {
        el.style.transition = "transform .8s cubic-bezier(.22,1,.36,1), box-shadow .5s, border-color .3s";
        el.style.transform = "";
      });
    });

    // Magnetic buttons
    $$(".magnetic").forEach(function (b) {
      b.addEventListener("mousemove", function (e) {
        var r = b.getBoundingClientRect();
        b.style.setProperty("--bx", ((e.clientX - r.left - r.width / 2) * 0.18).toFixed(1) + "px");
        b.style.setProperty("--by", ((e.clientY - r.top - r.height / 2) * 0.3).toFixed(1) + "px");
      });
      b.addEventListener("mouseleave", function () { b.style.setProperty("--bx", "0px"); b.style.setProperty("--by", "0px"); });
    });
  }

  /* ---------- Service links preselect the questionnaire ---------- */
  $$("[data-pick]").forEach(function (a) {
    a.addEventListener("click", function () {
      var box = document.querySelector('#diagnostico input[name="servicios"][value="' + a.dataset.pick + '"]');
      if (box) box.checked = true;
    });
  });

  var yr = $("#year");
  if (yr) yr.textContent = new Date().getFullYear();
})();

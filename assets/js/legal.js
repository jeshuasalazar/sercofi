/* Páginas legales: índice activo y año */
(function () {
  "use strict";
  var y = document.getElementById("y");
  if (y) y.textContent = new Date().getFullYear();

  var links = Array.prototype.slice.call(document.querySelectorAll(".lg-toc a"));
  if (!links.length || !("IntersectionObserver" in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      links.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id); });
    });
  }, { rootMargin: "-20% 0px -70% 0px" });
  links.forEach(function (a) {
    var s = document.querySelector(a.getAttribute("href"));
    if (s) io.observe(s);
  });
})();

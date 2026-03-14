// ══════════════════════════════════════════════════════════════
// EatCrayons – Page Transitions (Logo Expand)
// © Rise Marketing Co., LLC – EatCrayons. 2026.
// ══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  var LOGO_SVG = '<svg viewBox="0 0 601.92 618" xmlns="http://www.w3.org/2000/svg">' +
    '<path fill="white" d="M477.86,0H0v618h601.92V0h-124.06ZM477.86,493.94H124.06' +
    'v-124.06h229.74v-124.06H124.06v-121.76h353.8v369.88Z"/></svg>';

  // ── Build DOM once ──
  var overlay = document.createElement('div');
  overlay.className = 'page-transition';
  overlay.setAttribute('aria-hidden', 'true');

  var logo = document.createElement('div');
  logo.className = 'page-transition-logo';
  logo.innerHTML = LOGO_SVG;

  overlay.appendChild(logo);
  document.body.appendChild(overlay);

  // ── Arriving from a transition? Reveal the new page ──
  var arriving = sessionStorage.getItem('ec-transition');
  if (arriving) {
    sessionStorage.removeItem('ec-transition');

    // Start covered
    overlay.classList.add('is-covered');

    // Let the browser paint the covered state, then reveal
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.remove('is-covered');
        overlay.classList.add('is-entering');

        // Fade in page content
        var pageEl = document.querySelector('.contact-hero') ||
                     document.querySelector('.hero') ||
                     document.body;
        pageEl.classList.add('page-content-enter');

        // Clean up when animation ends
        overlay.addEventListener('animationend', function done(evt) {
          if (evt.target !== overlay) return;
          overlay.removeEventListener('animationend', done);
          overlay.classList.remove('is-entering');
          pageEl.classList.remove('page-content-enter');
        });
      });
    });
  }

  // ── Intercept navigation clicks ──
  var navigating = false;

  document.addEventListener('click', function (e) {
    if (navigating) return;

    var link = e.target.closest('a[href]');
    if (!link) return;

    var href = link.getAttribute('href');
    if (!href) return;
    if (href.charAt(0) === '#') return;
    if (href.indexOf('mailto:') === 0) return;
    if (href.indexOf('tel:') === 0) return;
    if (link.target === '_blank') return;
    if (link.hasAttribute('download')) return;

    // Resolve URL
    var url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;

    var currentPath = window.location.pathname.replace(/\/$/, '') || '/';
    var targetPath = url.pathname.replace(/\/$/, '') || '/';
    if (currentPath === targetPath) return;

    e.preventDefault();
    navigating = true;

    // Store flag for next page
    sessionStorage.setItem('ec-transition', '1');

    // Start exit animation
    overlay.classList.add('is-exiting');

    // Navigate when logo animation finishes
    logo.addEventListener('animationend', function go() {
      logo.removeEventListener('animationend', go);
      window.location.href = href;
    });

    // Safety fallback
    setTimeout(function () {
      window.location.href = href;
    }, 750);
  });
})();

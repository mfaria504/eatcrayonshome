// ══════════════════════════════════════════════════════════════
// EatCrayons – Page Transitions
// © Rise Marketing Co., LLC – EatCrayons. 2026.
// ══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── Create overlay + ring elements ──
  const overlay = document.createElement('div');
  overlay.className = 'page-transition';
  document.body.appendChild(overlay);

  const ring = document.createElement('div');
  ring.className = 'page-transition-ring';
  document.body.appendChild(ring);

  // ── Check if we're arriving from a transition ──
  const arriving = sessionStorage.getItem('ec-transition');
  if (arriving) {
    const data = JSON.parse(arriving);
    sessionStorage.removeItem('ec-transition');

    // Start fully covered, then reveal
    overlay.style.setProperty('--tx', data.tx);
    overlay.style.setProperty('--ty', data.ty);
    overlay.classList.add('is-covering');

    // Small delay so the browser paints the covered state first
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.remove('is-covering');
        overlay.classList.add('is-revealing');

        // Animate page content in
        const main = document.querySelector('main') ||
                     document.querySelector('.contact-hero') ||
                     document.querySelector('.hero') ||
                     document.body.firstElementChild;
        if (main) main.parentElement.classList.add('page-content-enter');

        // Clean up after reveal
        overlay.addEventListener('transitionend', function cleanup() {
          overlay.removeEventListener('transitionend', cleanup);
          overlay.classList.remove('is-revealing');
          overlay.style.removeProperty('--tx');
          overlay.style.removeProperty('--ty');
          if (main) main.parentElement.classList.remove('page-content-enter');
        });
      });
    });
  }

  // ── Intercept internal link clicks ──
  document.addEventListener('click', function (e) {
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');

    // Skip anchors, external links, mailto, tel, javascript
    if (!href) return;
    if (href.startsWith('#')) return;
    if (href.startsWith('mailto:')) return;
    if (href.startsWith('tel:')) return;
    if (href.startsWith('javascript:')) return;
    if (link.target === '_blank') return;
    if (link.hasAttribute('download')) return;

    // Skip if it's the same page (hash nav on homepage)
    const url = new URL(href, window.location.origin);
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
    const targetPath = url.pathname.replace(/\/$/, '') || '/';

    // If same page with just a hash change, let it work normally
    if (currentPath === targetPath) return;

    // Skip external origins
    if (url.origin !== window.location.origin) return;

    e.preventDefault();

    // ── Get click origin for the circle ──
    const x = e.clientX;
    const y = e.clientY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tx = ((x / vw) * 100).toFixed(1) + '%';
    const ty = ((y / vh) * 100).toFixed(1) + '%';

    // ── Fire the ring pulse at click point ──
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    ring.classList.remove('is-active');
    void ring.offsetWidth; // force reflow
    ring.classList.add('is-active');

    // ── Expand the dark overlay from click origin ──
    overlay.style.setProperty('--tx', tx);
    overlay.style.setProperty('--ty', ty);
    overlay.classList.add('is-entering');

    // ── Store transition data for the next page ──
    sessionStorage.setItem('ec-transition', JSON.stringify({ tx: tx, ty: ty }));

    // ── Navigate after the overlay covers the screen ──
    overlay.addEventListener('transitionend', function nav() {
      overlay.removeEventListener('transitionend', nav);
      window.location.href = href;
    });

    // Fallback in case transitionend doesn't fire
    setTimeout(function () {
      if (document.location.href !== href) {
        window.location.href = href;
      }
    }, 800);
  });
})();

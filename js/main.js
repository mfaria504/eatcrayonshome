// ══════════════════════════════════════════════════════════════
// EatCrayons – Main JavaScript
// © Rise Marketing Co., LLC – EatCrayons. 2026.
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // ── Scroll-driven header ──
  const header = document.getElementById('site-header');
  const announceBar = document.querySelector('.announce-bar');
  const logoPath = document.querySelector('.logo-mark svg path');
  const navLinks = document.querySelectorAll('.site-nav a');

  // Tag light-background sections
  ['.about', '.services', '.testimonials', '.pricing', '.cta-section'].forEach(sel => {
    document.querySelectorAll(sel).forEach(el => el.dataset.logoTheme = 'light');
  });

  const themedSections = Array.from(document.querySelectorAll('[data-logo-theme]'));

  function updateHeaderTheme() {
    const checkY = window.scrollY + header.getBoundingClientRect().bottom - 10;
    let isLight = false;

    for (const sec of themedSections) {
      const top = sec.offsetTop;
      const bottom = top + sec.offsetHeight;
      if (checkY >= top && checkY < bottom) {
        isLight = sec.dataset.logoTheme === 'light';
        break;
      }
    }

    logoPath.style.fill = isLight ? '#448cf7' : 'white';
    navLinks.forEach(a => {
      a.style.color = isLight ? 'rgba(18,18,23,0.8)' : 'white';
    });
  }

  function updateHeaderPosition() {
    const announceBottom = Math.max(0, announceBar.getBoundingClientRect().bottom);
    header.style.top = announceBottom + 'px';
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        updateHeaderPosition();
        updateHeaderTheme();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
  updateHeaderPosition();
  updateHeaderTheme();

  // ── Cycling word animation ──
  const words = ['looks.', 'operates.', 'scales.'];
  let idx = 0;
  const cycleEl = document.getElementById('word-cycle');

  function cycleWord() {
    cycleEl.style.opacity = '0';
    cycleEl.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      idx = (idx + 1) % words.length;
      cycleEl.textContent = words[idx];
      cycleEl.style.opacity = '1';
      cycleEl.style.transform = 'translateY(0)';
    }, 280);
  }

  setInterval(cycleWord, 2200);

  // ── Scroll fade-up observer ──
  const fadeEls = document.querySelectorAll('.fade-up');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  fadeEls.forEach(el => observer.observe(el));
});

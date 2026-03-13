// ══════════════════════════════════════════════════════════════
// EatCrayons – Main JavaScript
// © Rise Marketing Co., LLC – EatCrayons. 2026.
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // ── Scroll-driven header ──
  const header = document.getElementById('site-header');
  const announceBar = document.querySelector('.announce-bar');
  const siteNav = document.querySelector('.site-nav');
  const logoPath = document.querySelector('.logo-mark svg path');
  const navLinks = document.querySelectorAll('.site-nav a');

  const SCROLL_THRESHOLD = 60;

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

  function updateScrollState() {
    const scrolled = window.scrollY > SCROLL_THRESHOLD;
    announceBar.classList.toggle('hidden', scrolled);
    siteNav.classList.toggle('hidden', scrolled);
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        updateHeaderPosition();
        updateHeaderTheme();
        updateScrollState();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
  updateHeaderPosition();
  updateHeaderTheme();
  updateScrollState();

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

  // ── Tool stack row slide-in ──
  const toolStack = document.querySelector('.tool-stack');
  if (toolStack) {
    const toolObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          toolObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });
    toolObserver.observe(toolStack);
  }

  // ── Circle diagram pop-out ──
  const circleDiagram = document.querySelector('.circle-diagram');
  if (circleDiagram) {
    const circleObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('popped');
          circleObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.35 });
    circleObserver.observe(circleDiagram);
  }

  // ── Card stack fold-out ──
  const cardStack = document.querySelector('.card-stack');
  if (cardStack) {
    const stackObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('folded-out');
          stackObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.35 });
    stackObserver.observe(cardStack);
  }

  // ── Mobile menu ──
  const navToggle = document.querySelector('.nav-toggle');
  const mobileMenu = document.getElementById('mobile-menu');
  const mobileLinks = document.querySelectorAll('.mobile-menu-link');

  function openMenu() {
    mobileMenu.classList.add('is-open');
    mobileMenu.setAttribute('aria-hidden', 'false');
    navToggle.setAttribute('aria-expanded', 'true');
    header.classList.add('menu-open');
    document.body.style.overflow = 'hidden';
    announceBar.classList.add('hidden');
  }

  function closeMenu() {
    mobileMenu.classList.remove('is-open');
    mobileMenu.setAttribute('aria-hidden', 'true');
    navToggle.setAttribute('aria-expanded', 'false');
    header.classList.remove('menu-open');
    document.body.style.overflow = '';
    if (window.scrollY <= SCROLL_THRESHOLD) announceBar.classList.remove('hidden');
  }

  navToggle.addEventListener('click', () => {
    navToggle.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu();
  });

  mobileLinks.forEach(link => link.addEventListener('click', closeMenu));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mobileMenu.classList.contains('is-open')) closeMenu();
  });

  // Keep hamburger bar color in sync with header theming
  const origUpdateHeaderTheme = updateHeaderTheme;
  function updateToggleTheme(isLight) {
    document.querySelectorAll('.nav-toggle-bar').forEach(bar => {
      bar.style.background = isLight ? 'rgba(18,18,23,0.8)' : 'white';
    });
  }
  // Patch scroll handler to also update toggle bars
  window.addEventListener('scroll', () => {
    const checkY = window.scrollY + header.getBoundingClientRect().bottom - 10;
    let isLight = false;
    for (const sec of themedSections) {
      const top = sec.offsetTop;
      const bottom = top + sec.offsetHeight;
      if (checkY >= top && checkY < bottom) { isLight = sec.dataset.logoTheme === 'light'; break; }
    }
    updateToggleTheme(isLight);
  }, { passive: true });
  updateToggleTheme(false);
});

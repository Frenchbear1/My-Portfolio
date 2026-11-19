/*
 * Background aircraft for David's flying journey. Each airplane is a photoreal
 * render of a dimensionally accurate 3D model (see README), shipped as a small
 * transparent WebP. Only the aircraft on screen is downloaded; the next one in the
 * sequence is fetched while the browser is idle. Motion is transform-only.
 */
(() => {
  'use strict';
  const host = document.getElementById('aircraft-fleet');
  if (!host) return;
  const models = [
    { id: 'cub', name: 'Piper J-3 Cub' },
    { id: 'da20', name: 'Diamond DA20-C1' },
    { id: 'archer', name: 'Piper PA-28-181 Archer' },
    { id: 'c172', name: 'Cessna 172S Skyhawk' },
    { id: 'extra', name: 'Extra 330LX' },
    { id: 'seminole', name: 'Piper PA-44-180 Seminole' }
  ];
  // Section -> aircraft: intro, about, log, experience, tools, photos, contact.
  const order = [0, 1, 2, 3, 4, 5, 2];
  const sections = ['hero', 'about', 'log', 'path', 'tools', 'gallery', 'contact'];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const lite = document.documentElement.classList.contains('lite');
  const carriers = [...host.querySelectorAll('.plane')].map(el => ({ el, bob: el.querySelector('.bob'), imgs: [], w: 0 }));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let anchors = [], active = -1, want = -1, res = 800;

  const url = i => `assets/aircraft/${models[i].id}-${res}.webp`;
  function img(c, i) {
    if (c.imgs[i]) return c.imgs[i];
    const im = new Image();
    im.decoding = 'async'; im.alt = ''; im.draggable = false; im.className = 'aircraft-model';
    im.src = url(i);
    c.bob.append(im); c.imgs[i] = im;
    return im;
  }
  function activate(i) {
    want = i;
    const first = img(carriers[0], i);
    const go = () => {
      if (want !== i) return;
      active = i;
      host.dataset.aircraft = models[i].id;
      carriers.forEach(c => { img(c, i); c.imgs.forEach((m, k) => m && m.classList.toggle('active', k === i)); });
      host.classList.add('ready');
      // Warm the cache for the next aircraft when the browser has spare time.
      const next = order[Math.min(order.length - 1, order.indexOf(i) + 1)];
      const idle = window.requestIdleCallback || (f => setTimeout(f, 1200));
      if (next !== i && !lite) idle(() => { const p = new Image(); p.decoding = 'async'; p.src = url(next); });
    };
    (first.decode ? first.decode().catch(() => {}) : Promise.resolve()).then(go);
  }

  window.portfolioAircraft = {
    measure() {
      anchors = sections.map(id => { const s = document.getElementById(id); return s ? s.getBoundingClientRect().top + scrollY : 0; });
      // Pick one resolution per page load: sharp on large/retina screens, light elsewhere.
      if (active < 0) {
        const w = clamp(innerWidth * (innerWidth < 821 ? .88 : .46), 290, 780) * Math.min(2, devicePixelRatio || 1);
        res = !lite && w > 900 ? 1600 : 800;
      }
    },
    update(scroll, width, height, p) {
      const focus = scroll + height * .35;
      let stage = 0;
      for (let i = 1; i < anchors.length; i++) if (focus >= anchors[i]) stage = i;
      const selected = order[stage];
      if (selected !== want) activate(selected);
      const mobile = width < 821, still = reduced.matches;
      carriers.forEach((c, i) => {
        const w = i === 0 ? clamp(width * (mobile ? .9 : .5), 300, 820) : clamp(width * .26, 160, 400);
        if (w !== c.w) { c.el.style.width = w + 'px'; c.w = w; }
        const drift = still ? 0 : Math.sin(p * Math.PI * 3 + i * 2) * width * .09;
        const x = i === 0 ? width * .74 - w * .5 + drift : width * .04 + drift * .5;
        const y = i === 0 ? height * (mobile ? .60 : .36) - w * .31 : height * .80 - w * .31;
        const bank = still ? 0 : Math.sin(p * 8 + i) * 4;
        c.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${bank.toFixed(2)}deg)${i ? ' scaleX(-1)' : ''}`;
      });
    }
  };
  document.addEventListener('visibilitychange', () => host.classList.toggle('is-paused', document.hidden));
})();

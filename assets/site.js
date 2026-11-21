/*
 * Portfolio interactions. Everything scroll-linked runs in one requestAnimationFrame
 * loop that only runs while the page is moving, and layout is measured once per
 * resize instead of every frame, so idle pages cost nothing and slow devices stay smooth.
 */
(() => {
  'use strict';
  const $ = (s, c = document) => [...c.querySelectorAll(s)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------------------------------------------------------------- layout cache
  let W = innerWidth, H = innerHeight, maxScroll = 1, tlTop = 0, tlHeight = 0;
  const tl = document.querySelector('.tl'), tlp = document.getElementById('tlp');
  function measure() {
    maxScroll = Math.max(1, root.scrollHeight - H);
    if (tl) { const r = tl.getBoundingClientRect(); tlTop = r.top + scrollY; tlHeight = r.height; }
    window.portfolioAircraft?.measure();
    kick();
  }

  // ---------------------------------------------------------------- sky, hud, hero
  const stops = [0, .3, .6, 1];
  const skyLayers = $('#sky span'), stars = document.getElementById('stars'), prog = document.getElementById('prog');
  const clouds = $('.cloud');
  let lastSky = -1;
  function paintSky(t) {
    if (Math.abs(t - lastSky) < .0008) return; lastSky = t;
    let s = 0; while (s < stops.length - 2 && t > stops[s + 1]) s++;
    const f = clamp((t - stops[s]) / (stops[s + 1] - stops[s]), 0, 1);
    skyLayers.forEach((l, i) => l.style.opacity = i === s ? '1' : i === s + 1 ? f.toFixed(3) : '0');
    stars.style.opacity = Math.max(0, (t - .75) * 4).toFixed(3);
  }

  const hero = document.getElementById('hero');
  const tx = document.querySelector('.hp>div'), gg = document.querySelector('.gauge'), gi = gg.querySelector('img');
  let heroE = -1;
  function heroScroll() {
    const e = (u => u * u * (3 - 2 * u))(clamp((scrollY / H - .62) / .32, 0, 1));
    if (e === heroE) return; heroE = e;
    tx.style.opacity = 1 - e; tx.style.transform = `translateY(${-e * 50}px)`;
    gg.style.opacity = 1 - e; gg.style.transform = `translateY(${-e * 80}px) scale(${1 - e * .25}) rotate(${e * -6}deg)`;
    gi.style.transform = `scale(${1.12 + e * .35})`;
  }

  const ALT_MAX = 12500, hud = document.getElementById('hud'), altEl = document.getElementById('alt'),
    altCue = document.getElementById('alt-cue'), altSource = document.getElementById('alt-source'), altFact = document.getElementById('alt-fact');
  const altitudeFacts = [
    {at:0,source:'FAR 91.119',text:'Keep a safe landing option',detail:'Fly high enough to make an emergency landing without undue hazard if power fails.',url:'https://www.ecfr.gov/current/title-14/section-91.119'},
    {at:500,source:'FAR 91.119',text:'Noncongested · 500′ AGL',detail:'Except for takeoff or landing: generally at least 500 feet above the surface in noncongested areas; special separation language applies over open water or sparsely populated areas.',url:'https://www.ecfr.gov/current/title-14/section-91.119'},
    {at:1000,source:'FAR 91.119',text:'Congested · +1,000′',detail:'Except for takeoff or landing: 1,000 feet above the highest obstacle within 2,000 feet horizontally over congested areas or open-air assemblies.',url:'https://www.ecfr.gov/current/title-14/section-91.119'},
    {at:1200,source:'FAR 91.155',text:'Class G · day/night split',detail:'At or below 1,200 feet AGL, airplane VFR minimums are generally 1 SM and clear of clouds by day; 3 SM and 500 below, 1,000 above, 2,000 horizontal at night. Exceptions apply.',url:'https://www.ecfr.gov/current/title-14/section-91.155'},
    {at:1500,source:'FAR 91.303',text:'Acro floor · 1,500′ AGL',detail:'Aerobatic flight is prohibited below 1,500 feet AGL and when flight visibility is less than 3 statute miles; other location limits also apply.',url:'https://www.ecfr.gov/current/title-14/section-91.303'},
    {at:2500,source:'FAR 91.117',text:'Near C/D · 200 KIAS max',detail:'At or below 2,500 feet AGL and within 4 NM of the primary airport of Class C or D airspace: generally no more than 200 KIAS. Exceptions apply.',url:'https://www.ecfr.gov/current/title-14/section-91.117'},
    {at:3500,source:'VFR · FAR 91.159',text:'Cruise altitude · 3,500′',detail:'3,500 feet MSL is the first listed VFR cruising altitude for magnetic courses 0°–179°. The rule applies in level cruise more than 3,000 feet above the surface; courses 180°–359° use even thousands plus 500.',url:'https://www.ecfr.gov/current/title-14/section-91.159'},
    {at:4000,source:'IFR · FAR 91.179',text:'Cruise altitude · 4,000′',detail:'For IFR level cruise in uncontrolled airspace, 4,000 feet MSL is the first even-thousand altitude above 3,000 for magnetic courses 180°–359°. Controlled airspace uses the ATC-assigned altitude.',url:'https://www.ecfr.gov/current/title-14/section-91.179'},
    {at:5000,source:'FAA HYPOXIA',text:'Night O₂ recommended',detail:'The FAA recommends supplemental oxygen above 5,000 feet at night; night vision can deteriorate at a cabin pressure altitude as low as 5,000 feet.',url:'https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap8_section_1.html'},
    {at:7000,source:'FAR 91.155',text:'Class E <10k · 3–152',detail:'In Class E below 10,000 feet MSL: 3 SM visibility, 500 feet below, 1,000 feet above, and 2,000 feet horizontal from clouds.',url:'https://www.ecfr.gov/current/title-14/section-91.155'},
    {at:9500,source:'FAR 91.117',text:'<10k MSL · 250 KIAS max',detail:'Below 10,000 feet MSL, indicated airspeed is generally limited to 250 knots unless otherwise authorized or the minimum safe airspeed is higher.',url:'https://www.ecfr.gov/current/title-14/section-91.117'},
    {at:10000,source:'FAA HYPOXIA',text:'Day O₂ recommended',detail:'For optimum protection, the FAA recommends supplemental oxygen above 10,000 feet during the day.',url:'https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap8_section_1.html'},
    {at:10500,source:'FAR 91.155',text:'Class E ≥10k · 5–111',detail:'In Class E at or above 10,000 feet MSL: 5 SM visibility, 1,000 feet below, 1,000 feet above, and 1 SM horizontal from clouds.',url:'https://www.ecfr.gov/current/title-14/section-91.155'},
    {at:11000,source:'FAR 91.215 / .225',text:'Mode C + ADS-B area*',detail:'At and above 10,000 feet MSL in the contiguous U.S. and DC, Mode C and ADS-B Out rules generally apply; airspace at and below 2,500 feet AGL and some aircraft are excepted.',url:'https://www.ecfr.gov/current/title-14/section-91.225'},
    {at:12000,source:'FAA HYPOXIA',text:'Hypoxia effects rise',detail:'From about 12,000 to 15,000 feet cabin pressure altitude, judgment, memory, alertness, coordination, and calculation ability can be impaired.',url:'https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap8_section_1.html'},
    {at:12500,source:'FAR 91.211',text:'>12.5k · O₂ after 30 min',detail:'Above 12,500 through 14,000 feet cabin pressure altitude, required minimum flight crew must use supplemental oxygen for the portion exceeding 30 minutes.',url:'https://www.ecfr.gov/current/title-14/section-91.211'}
  ];
  let factIndex = -1, lastAlt = -1;
  function updateAltitude(altitude) {
    if (altitude === lastAlt) return; lastAlt = altitude;
    altEl.textContent = altitude.toLocaleString();
    let next = 0; for (let i = 1; i < altitudeFacts.length; i++) { if (altitude >= altitudeFacts[i].at) next = i; else break; }
    if (next === factIndex) return; factIndex = next;
    const f = altitudeFacts[next];
    altSource.textContent = f.source; altFact.textContent = f.text; altCue.href = f.url; altCue.title = f.detail;
    altCue.setAttribute('aria-label', `${f.source}: ${f.text}. ${f.detail} Opens the official source in a new tab.`);
    hud.classList.remove('fact-swap'); void hud.offsetWidth; hud.classList.add('fact-swap');
  }

  // ---------------------------------------------------------------- the loop
  let sp = 0, running = false;
  function frame(now) {
    const y = scrollY, tp = clamp(y / maxScroll, 0, 1);
    sp = reduced.matches ? tp : lerp(sp, tp, .1);
    if (Math.abs(sp - tp) < .0004) sp = tp;
    if (y < H * 1.1 || heroE !== 1) heroScroll();
    paintSky(sp);
    prog.style.transform = `scaleX(${tp.toFixed(4)})`;
    window.portfolioAircraft?.update(y, W, H, sp);
    clouds.forEach((c, i) => c.style.transform = `translate3d(${(Math.sin(sp * 5 + i) * 80).toFixed(1)}px,${(Math.sin(sp * Math.PI * 2 + i * 1.8) * H * .12).toFixed(1)}px,0)`);
    updateAltitude(Math.min(ALT_MAX, Math.round(sp * ALT_MAX / 10) * 10));
    if (tl) tlp.style.transform = `scaleY(${tlHeight ? (clamp(H * .6 - (tlTop - y), 0, tlHeight) / tlHeight).toFixed(4) : 0})`;
    if (sp !== tp) requestAnimationFrame(frame); else running = false;
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', () => {
    // Mobile URL-bar show/hide changes only the height; ignore it to avoid jumps.
    const nw = innerWidth;
    if (nw !== W || !matchMedia('(max-width:820px)').matches) { W = nw; H = innerHeight; measure(); }
  }, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(() => measure()).observe(document.querySelector('main'));
  document.fonts?.ready.then(measure);
  addEventListener('load', measure);
  measure();

  // Hero idle motion and typing only while the hero is on screen and the tab is visible.
  let heroVisible = true;
  const setHeroLive = () => root.classList.toggle('hero-live', heroVisible && !document.hidden);
  new IntersectionObserver(es => { heroVisible = es[0].isIntersecting; setHeroLive(); if (heroVisible) type(); }).observe(hero);
  document.addEventListener('visibilitychange', () => { setHeroLive(); if (!document.hidden) type(); });

  const roles = ['Certified Flight Instructor', 'Commercial Pilot', 'Aeronautics Tutor', 'B.S. Aeronautics, 4.0 GPA'], rl = document.getElementById('role');
  let ri = 0, ci = roles[0].length, del = false, typing = false, typeTimer;
  function type() {
    if (typing || reduced.matches) return; typing = true; clearTimeout(typeTimer); typeTimer = setTimeout(step, 1600);
  }
  function step() {
    if (!root.classList.contains('hero-live')) { typing = false; return; }
    const w = roles[ri];
    if (!del && ci === w.length) { del = true; typeTimer = setTimeout(step, 1600); return; }
    if (del && ci === 0) { del = false; ri = (ri + 1) % roles.length; }
    ci += del ? -1 : 1; rl.textContent = roles[ri].slice(0, ci);
    typeTimer = setTimeout(step, del ? 30 : 65);
  }

  // ---------------------------------------------------------------- reveals + counters + bars
  $('[data-n]').forEach(el => el.textContent = '0');
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; const t = e.target; t.classList.add('in'); io.unobserve(t);
    $('[data-n]', t).forEach(el => {
      const n = +el.dataset.n, T = reduced.matches ? 0 : 1600, t0 = performance.now();
      (function u(t1) { const f = T ? Math.min(1, (t1 - t0) / T) : 1, v = n * (1 - Math.pow(1 - f, 4)); el.textContent = n % 1 ? v.toFixed(1) : Math.round(v); if (f < 1) requestAnimationFrame(u); })(t0);
    });
    if (t.classList.contains('bars')) $('.bar', t).forEach((b, i) => setTimeout(() => b.querySelector('i').style.transform = `scaleX(${(b.dataset.v / 290.7).toFixed(4)})`, i * 150));
  }), { threshold: .2 });
  $('.rv').forEach((e, i) => { e.style.transitionDelay = (i % 3) * .08 + 's'; io.observe(e); });

  const secs = $('section'), links = $('nav a');
  const navIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.hash === '#' + e.target.id)); }), { rootMargin: '-45% 0px -45% 0px' });
  secs.forEach(s => navIO.observe(s));

  // ---------------------------------------------------------------- photos
  $('.ph img').forEach(img => { if (img.complete && img.naturalWidth) img.classList.add('ok'); else img.addEventListener('load', () => img.classList.add('ok'), { once: true }); });
  const lb = document.getElementById('lb'), li = lb.querySelector('img'), lbc = document.getElementById('lbc'), lbt = document.getElementById('lbt');
  let vis = [], cur = 0, lbReturn = null;
  const full = c => c.querySelector('img').dataset.full || c.querySelector('img').currentSrc;
  function show(i) {
    cur = (i + vis.length) % vis.length;
    const img = vis[cur].querySelector('img');
    li.src = full(vis[cur]); li.alt = img.alt;
    lbt.textContent = img.alt; lbc.textContent = vis.length > 1 ? `${cur + 1} / ${vis.length}` : '';
    li.style.animation = 'none'; void li.offsetWidth; li.style.animation = '';
    lb.querySelectorAll('.lbn').forEach(b => b.hidden = vis.length < 2);
    [cur + 1, cur - 1].forEach(j => { if (vis.length > 1) { const p = new Image(); p.src = full(vis[(j + vis.length) % vis.length]); } });
  }
  function openLb(card) {
    lbReturn = card;
    vis = card.closest('.gal') ? $('.gal .ph:not(.hide)') : [card];
    show(vis.indexOf(card));
    lb.classList.add('on'); lb.setAttribute('aria-hidden', 'false'); document.body.classList.add('lb-open');
    document.getElementById('lx').focus({ preventScroll: true });
  }
  function closeLb() {
    if (!lb.classList.contains('on')) return;
    lb.classList.remove('on'); lb.setAttribute('aria-hidden', 'true'); document.body.classList.remove('lb-open');
    lbReturn?.focus({ preventScroll: true });
  }
  const fine = matchMedia('(hover:hover) and (pointer:fine)');
  $('.ph').forEach(c => {
    const fr = c.querySelector('.fr');
    if (fine.matches && !reduced.matches) {
      c.addEventListener('mousemove', e => { const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; fr.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) scale(1.02)`; });
      c.addEventListener('mouseleave', () => fr.style.transform = '');
    }
    c.addEventListener('click', () => openLb(c));
  });
  document.getElementById('lp').onclick = e => { e.stopPropagation(); show(cur - 1); };
  document.getElementById('ln').onclick = e => { e.stopPropagation(); show(cur + 1); };
  document.getElementById('lx').onclick = e => { e.stopPropagation(); closeLb(); };
  li.addEventListener('click', e => e.stopPropagation());
  lb.addEventListener('click', closeLb);
  let tx0 = 0;
  lb.addEventListener('touchstart', e => tx0 = e.touches[0].clientX, { passive: true });
  lb.addEventListener('touchend', e => { const d = e.changedTouches[0].clientX - tx0; if (Math.abs(d) > 50 && vis.length > 1) { e.preventDefault(); show(cur + (d < 0 ? 1 : -1)); } });
  $('.filters .btn').forEach(b => b.onclick = () => {
    $('.filters .btn').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    $('.gal .ph').forEach(p => p.classList.toggle('hide', !(b.dataset.f === 'all' || p.dataset.cat === b.dataset.f)));
  });

  // ---------------------------------------------------------------- tool viewer
  const tv = document.getElementById('tool-viewer'), tf = document.getElementById('tool-frame'), ts = document.getElementById('tool-stage'),
    vt = document.getElementById('tool-viewer-title'), vk = document.getElementById('tool-viewer-type'), ve = document.getElementById('tool-external'), vc = document.getElementById('tool-close');
  let toolReturn = null, toolTimer;
  const toolBackdrop = lock => [...document.body.children].forEach(el => { if (el !== tv && el.tagName !== 'SCRIPT') el.inert = lock; });
  function openTool(card) {
    clearTimeout(toolTimer); toolReturn = card;
    const url = card.dataset.toolUrl, title = card.dataset.toolTitle;
    vt.textContent = title; vk.textContent = card.dataset.toolType; ve.href = url; tf.title = title;
    ts.classList.remove('loaded'); tf.src = url;
    tv.setAttribute('aria-hidden', 'false'); document.body.classList.add('tool-open'); toolBackdrop(true);
    requestAnimationFrame(() => { tv.classList.add('on'); requestAnimationFrame(() => vc.focus({ preventScroll: true })); });
  }
  function closeTool() {
    if (!tv.classList.contains('on')) return;
    tv.classList.remove('on'); tv.setAttribute('aria-hidden', 'true'); document.body.classList.remove('tool-open'); toolBackdrop(false);
    toolTimer = setTimeout(() => { tf.src = 'about:blank'; ts.classList.remove('loaded'); }, 420);
    toolReturn?.focus({ preventScroll: true });
  }
  $('.tool-card').forEach(card => card.addEventListener('click', () => openTool(card)));
  tf.addEventListener('load', () => { if (tf.getAttribute('src') !== 'about:blank') ts.classList.add('loaded'); });
  vc.addEventListener('click', closeTool);
  tv.addEventListener('click', e => { if (e.target === tv) closeTool(); });

  // ---------------------------------------------------------------- flight sim
  // Full-screen overlay with the sim in an iframe (loaded only when opened). Closing restores the
  // exact scroll position and unloads the sim so the portfolio stays light.
  const sv = document.getElementById('sim-viewer'), sf = document.getElementById('sim-frame');
  let simY = 0, simReturn = null, simTimer;
  function openSim(btn) {
    clearTimeout(simTimer); simReturn = btn; simY = scrollY;
    if (sf.getAttribute('src') === 'about:blank') sf.src = 'sim/';
    sv.setAttribute('aria-hidden', 'false'); document.body.classList.add('sim-open');
    [...document.body.children].forEach(el => { if (el !== sv && el.tagName !== 'SCRIPT') el.inert = true; });
    const fs = sv.requestFullscreen || sv.webkitRequestFullscreen;
    if (fs) { try { const p = fs.call(sv, { navigationUI: 'hide' }); p && p.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {}); } catch { /* not allowed */ } }
    requestAnimationFrame(() => { sv.classList.add('on'); sf.focus(); });
  }
  function closeSim() {
    if (!sv.classList.contains('on')) return;
    const fe = document.fullscreenElement || document.webkitFullscreenElement;
    if (fe) (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch?.(() => {});
    sv.classList.remove('on'); sv.setAttribute('aria-hidden', 'true'); document.body.classList.remove('sim-open');
    [...document.body.children].forEach(el => { if (el !== sv && el.tagName !== 'SCRIPT') el.inert = false; });
    const back = () => scrollTo({ top: simY, behavior: 'instant' });
    back(); requestAnimationFrame(back); setTimeout(back, 250);
    simTimer = setTimeout(() => { sf.src = 'about:blank'; }, 400);
    simReturn?.focus({ preventScroll: true });
  }
  $('[data-sim-open]').forEach(b => b.addEventListener('click', () => openSim(b)));
  addEventListener('message', e => { if (e.source === sf.contentWindow && e.data && e.data.type === 'skyhawk:exit') closeSim(); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && sv.classList.contains('on')) scrollTo({ top: simY, behavior: 'instant' }); });

  addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeTool(); closeLb(); }
    if (!lb.classList.contains('on')) return;
    if (e.key === 'ArrowRight') show(cur + 1);
    if (e.key === 'ArrowLeft') show(cur - 1);
    if (e.key === 'Tab') { // keep focus inside the viewer
      const f = $('button:not([hidden])', lb), i = f.indexOf(document.activeElement);
      e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
})();

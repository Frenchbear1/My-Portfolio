// Landscape lock for phones. iOS can't lock a web page to landscape (and its Control Center lock only
// locks portrait), and rolling the phone hard while flying makes the browser flip to portrait. So the
// app remembers which way the phone was held in landscape and, whenever the browser reports portrait,
// draws the whole page rotated back to that landscape. Tilt math uses the remembered angle too.
// Turning on the iPhone's portrait lock is fine: the cockpit simply stays in landscape.
export function createOrient(app, { onChange } = {}) {
  let rot = 0, lock = null, upDev = null, active = false;
  const screenAngle = () => { const a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : +window.orientation || 0; return ((a % 360) + 360) % 360; };
  function apply() {
    const portrait = innerHeight > innerWidth, ang = screenAngle();
    let next = 0;
    if (!portrait) { if (ang === 90 || ang === 270) lock = ang; else if (lock == null) lock = 90; }
    else if (active) {
      if (upDev && Math.abs(upDev.x) > 0.55) lock = upDev.x > 0 ? 90 : 270;            // gravity says which way it is held sideways
      if (lock != null && !(upDev && Math.abs(upDev.y) > 0.8)) next = lock === 90 ? 90 : -90;  // held upright: really portrait
    }
    document.body.classList.toggle('needrotate', active && portrait && next === 0);
    if (next !== rot || app.dataset.w != innerWidth || app.dataset.h != innerHeight) {
      rot = next; app.dataset.w = innerWidth; app.dataset.h = innerHeight;
      if (rot === 0) app.removeAttribute('style');
      else Object.assign(app.style, { position: 'fixed', left: '0', top: '0', width: innerHeight + 'px', height: innerWidth + 'px', transformOrigin: 'top left', transform: rot === 90 ? 'rotate(90deg) translateY(-100%)' : 'rotate(-90deg) translateX(-100%)' });
      onChange && onChange(rot);
    }
  }
  addEventListener('resize', () => setTimeout(apply, 60)); screen.orientation && screen.orientation.addEventListener && screen.orientation.addEventListener('change', () => setTimeout(apply, 60));
  return {
    /** call with the "up" (gravity) vector in device axes whenever motion data arrives */
    up(v) { upDev = v; if (innerHeight > innerWidth && active) apply(); },
    activate(on = true) { active = on; apply(); },
    /** the landscape angle the tilt math should use */
    angle() { return rot ? lock : screenAngle(); },
    get rot() { return rot; },
    /** pointer position in the page's own (unrotated) coordinates */
    P(e) { const x = e.clientX, y = e.clientY; return rot === 90 ? { x: y, y: innerWidth - x } : rot === -90 ? { x: innerHeight - y, y: x } : { x, y }; },
    /** an element's rectangle in the page's own coordinates */
    R(el) {
      const b = el.getBoundingClientRect(); if (!rot) return b;
      const c = [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]].map(([x, y]) => this.P({ clientX: x, clientY: y }));
      const l = Math.min(...c.map(p => p.x)), t = Math.min(...c.map(p => p.y)), r = Math.max(...c.map(p => p.x)), bt = Math.max(...c.map(p => p.y));
      return { left: l, top: t, right: r, bottom: bt, width: r - l, height: bt - t, x: l, y: t };
    },
  };
}

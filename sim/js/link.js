// Phone cockpit link. GitHub Pages has no server, so the computer and the phone talk directly over
// WebRTC; the free PeerJS broker only introduces them. The computer shows a QR code with a room id,
// the phone opens pad.html#room and streams its controls about 25 times a second.
const PEER_JS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const QR_JS = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
export const PREFIX = 'skyhawk-dl-';
const scripts = {};
export function loadScript(src) {
  return (scripts[src] ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }));
}
const newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');

export function createLink({ onState = () => {}, onCmd = () => {} } = {}) {
  let peer = null, conn = null, room = null, ctl = null, last = 0, state = 'off', lastCmd = null, starting = null;
  const set = (st, detail = '') => { state = st; onState(st, detail); };
  function open() {
    try { room = sessionStorage.getItem('skyhawk-room') || newRoom(); sessionStorage.setItem('skyhawk-room', room); } catch { room = room || newRoom(); }
    peer = new window.Peer(PREFIX + room, { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } });
    peer.on('open', () => set(conn && conn.open ? 'connected' : 'waiting'));
    peer.on('connection', c => {
      if (conn && conn !== c) try { conn.close(); } catch { /* already closed */ }
      conn = c;
      c.on('open', () => { set('connected'); clearInterval(c._hb); c._hb = setInterval(() => { if (c.open) try { c.send({ t: 'hi' }); } catch { /* closing */ } else clearInterval(c._hb); }, 1000); });
      c.on('data', d => {
        if (!d || d.t !== 'ctl') return;
        ctl = d.c; last = performance.now();
        if (ctl.cmd && (!lastCmd || ctl.cmd.id !== lastCmd)) { lastCmd = ctl.cmd.id; onCmd(ctl.cmd.type); }
      });
      c.on('close', () => { if (conn === c) { conn = null; ctl = null; set('waiting'); } });
    });
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch { /* retry later */ } }, 1500); });
    peer.on('error', e => {
      if (e.type === 'unavailable-id') { try { sessionStorage.removeItem('skyhawk-room'); } catch { /* private */ } peer.destroy(); open(); return; }
      if (e.type === 'peer-unavailable') return;
      set('error', e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' ? 'Could not reach the pairing service. Check your connection.' : String(e.type || e));
    });
  }
  return {
    async start() {
      if (peer && !peer.destroyed) return;
      starting ||= Promise.all([loadScript(PEER_JS), loadScript(QR_JS)]).then(() => { set('starting'); open(); }).catch(e => { starting = null; set('error', e.message); });
      return starting;
    },
    url() { return room ? new URL('pad.html#' + room, location.href).href : ''; },
    get room() { return room; },
    qrSvg(cell = 5) { if (!window.qrcode || !room) return ''; const q = window.qrcode(0, 'M'); q.addData(this.url()); q.make(); return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true }); },
    get active() { return !!ctl && performance.now() - last < 1500; },
    get ctl() { return ctl; },
    get state() { return state; },
    send(tel) { if (conn && conn.open) try { conn.send({ t: 'tel', d: tel }); } catch { /* channel closing */ } },
  };
}

// Draws diagrams in the draftwall diagram style from a small spec with explicit coordinates.
// flow: { nodes: { id: {x,y,w,h,t,s,k,shape} }, groups: [{x,y,w,h,t}], edges: [[from,to,{t,k,n,a,b,mid}]] }
// seq:  { lanes: [{id,t,x}], top, rows: [[from,to,label,{k,n}]], step, acts: [{lane,from,to}] }
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
  const text = (parent, x, y, str, cls, anchor = 'middle') => { const t = el('text', { x, y, class: cls, 'text-anchor': anchor, 'dominant-baseline': 'central' }, parent); t.textContent = str; return t; };
  const COLORS = { '': 'var(--edge)', hl: 'var(--accent)', add: 'var(--add)', del: 'var(--del)', dash: 'var(--edge)' };

  function defs(svg) {
    const d = el('defs', {}, svg);
    for (const [k, c] of Object.entries(COLORS)) {
      const m = el('marker', { id: 'ar-' + (k || 'n'), viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, d);
      m.setAttribute('markerWidth', 10); m.setAttribute('markerHeight', 10);
      el('path', { d: 'M1 1.5 9 5 1 8.5Z', style: 'fill:' + c }, m);
    }
  }

  function node(g, id, n) {
    const x = n.x, y = n.y, w = n.w || 180, h = n.h || (n.s ? 60 : 46);
    const grp = el('g', { class: 'n ' + (n.k || ''), 'data-id': id }, g);
    if (n.rows) {
      const hh = 34, rh = 24, H = hh + n.rows.length * rh + 8;
      el('rect', { class: 'n-box', x, y, width: w, height: H, rx: 8 }, grp);
      el('line', { x1: x, x2: x + w, y1: y + hh, y2: y + hh, stroke: 'currentColor', class: 'n-rule' }, grp);
      text(grp, x + 14, y + hh / 2, n.t, 'n-t', 'start');
      n.rows.forEach((r, i) => { const [a, b] = r.split(':'); text(grp, x + 14, y + hh + 16 + i * rh, a, 'n-f', 'start'); if (b) text(grp, x + w - 14, y + hh + 16 + i * rh, b, 'n-s', 'end'); });
      return { x, y, w, h: H };
    }
    if (n.shape === 'store') {
      const ry = 7;
      el('path', { class: 'n-box', d: `M${x} ${y + ry} a${w / 2} ${ry} 0 0 0 ${w} 0 a${w / 2} ${ry} 0 0 0 ${-w} 0 v${h - 2 * ry} a${w / 2} ${ry} 0 0 0 ${w} 0 v${-(h - 2 * ry)}` }, grp);
    } else {
      el('rect', { class: 'n-box', x, y, width: w, height: h, rx: n.shape === 'actor' ? h / 2 : 8 }, grp);
    }
    const cy = y + h / 2 + (n.shape === 'store' ? 4 : 0);
    if (n.s) { text(grp, x + w / 2, cy - 9, n.t, 'n-t'); text(grp, x + w / 2, cy + 11, n.s, 'n-s'); }
    else text(grp, x + w / 2, cy, n.t, 'n-t');
    if (n.k === 'add' || n.k === 'del') {
      el('circle', { cx: x + w, cy: y, r: 10, style: 'fill:var(--' + n.k + ')' }, grp);
      text(grp, x + w, y + 0.5, n.k === 'add' ? '+' : '−', 'badge');
    }
    return { x, y, w, h };
  }

  const port = (b, side) => side === 'r' ? [b.x + b.w, b.y + b.h / 2] : side === 'l' ? [b.x, b.y + b.h / 2] : side === 't' ? [b.x + b.w / 2, b.y] : [b.x + b.w / 2, b.y + b.h];

  function route(A, B, o) {
    let a = o.a, b = o.b;
    if (!a) {
      const dx = (B.x + B.w / 2) - (A.x + A.w / 2), dy = (B.y + B.h / 2) - (A.y + A.h / 2);
      const horiz = B.x >= A.x + A.w - 4 || B.x + B.w <= A.x + 4;
      if (horiz && Math.abs(dx) > Math.abs(dy) * 0.6) { a = dx > 0 ? 'r' : 'l'; b = b || (dx > 0 ? 'l' : 'r'); }
      else { a = dy > 0 ? 'b' : 't'; b = b || (dy > 0 ? 't' : 'b'); }
    }
    b = b || ({ r: 'l', l: 'r', t: 'b', b: 't' })[a];
    const p = port(A, a), q = port(B, b);
    const pts = [p];
    const hA = a === 'r' || a === 'l', hB = b === 'r' || b === 'l';
    if (hA && hB) { if (p[1] !== q[1]) { const mx = o.mid ?? (p[0] + q[0]) / 2; pts.push([mx, p[1]], [mx, q[1]]); } }
    else if (!hA && !hB) { if (p[0] !== q[0]) { const my = o.mid ?? (p[1] + q[1]) / 2; pts.push([p[0], my], [q[0], my]); } }
    else if (hA) pts.push([q[0], p[1]]);
    else pts.push([p[0], q[1]]);
    pts.push(q);
    return pts;
  }

  function pathD(pts, r = 10) {
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
      const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y), rr = Math.min(r, l1 / 2, l2 / 2);
      const ax = x - (x - px) / l1 * rr, ay = y - (y - py) / l1 * rr, bx = x + (nx - x) / l2 * rr, by = y + (ny - y) / l2 * rr;
      d += ` L${ax} ${ay} Q${x} ${y} ${bx} ${by}`;
    }
    const l = pts[pts.length - 1];
    return d + ` L${l[0]} ${l[1]}`;
  }

  function label(g, x, y, o) {
    if (o.n) {
      const s = el('g', { class: 'step' }, g);
      el('circle', { cx: o.t ? x - measure(o.t) / 2 - 16 : x, cy: y, r: 11 }, s);
      text(s, o.t ? x - measure(o.t) / 2 - 16 : x, y + .5, String(o.n), '');
    }
    if (!o.t) return;
    const lb = el('g', { class: 'e-lb ' + (o.k || '') }, g), w = measure(o.t) + 12;
    el('rect', { x: x - w / 2, y: y - 10, width: w, height: 20, rx: 4 }, lb);
    text(lb, x, y, o.t, '');
  }
  const measure = s => s.length * 7.3;

  function midpoint(pts) {
    let best = 0, bi = 0;
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (l > best) { best = l; bi = i; } }
    return [(pts[bi][0] + pts[bi + 1][0]) / 2, (pts[bi][1] + pts[bi + 1][1]) / 2];
  }

  window.flow = (svg, spec) => {
    defs(svg);
    const gg = el('g', {}, svg), ge = el('g', {}, svg), gn = el('g', {}, svg), gl = el('g', {}, svg);
    for (const g of spec.groups || []) {
      el('rect', { class: 'grp', x: g.x, y: g.y, width: g.w, height: g.h, rx: 14 }, gg);
      text(gg, g.x + 16, g.y + 18, g.t, 'grp-t', 'start');
    }
    const boxes = {};
    for (const [id, n] of Object.entries(spec.nodes)) boxes[id] = node(gn, id, n);
    for (const [f, t, o = {}] of spec.edges || []) {
      const pts = route(boxes[f], boxes[t], o), k = o.k || '';
      const color = k === 'dash' ? 'n' : (k || 'n');
      el('path', { class: 'e ' + k, d: pathD(pts), 'marker-end': `url(#ar-${color})`, ...(o.both ? { 'marker-start': `url(#ar-${color})` } : {}) }, ge);
      const [mx, my] = o.at || midpoint(pts);
      label(gl, mx, my, o);
    }
  };

  window.seq = (svg, spec) => {
    defs(svg);
    const top = spec.top ?? 0, step = spec.step || 52, h = top + 70 + spec.rows.length * step;
    const lanes = Object.fromEntries(spec.lanes.map(l => [l.id, l]));
    const gl = el('g', {}, svg), ga = el('g', {}, svg), gm = el('g', {}, svg);
    for (const l of spec.lanes) {
      const w = l.w || 150;
      el('line', { class: 'life', x1: l.x, x2: l.x, y1: top + 46, y2: h }, gl);
      node(gl, l.id, { x: l.x - w / 2, y: top, w, h: 46, t: l.t, k: l.k, shape: l.shape });
    }
    const rowY = i => top + 80 + i * step;
    for (const a of spec.acts || []) el('rect', { class: 'act', x: lanes[a.lane].x - 5, y: rowY(a.from) - 12, width: 10, height: rowY(a.to) - rowY(a.from) + 24, rx: 2 }, ga);
    spec.rows.forEach(([f, t, s, o = {}], i) => {
      const y = rowY(i), x1 = lanes[f].x, x2 = lanes[t].x, dir = Math.sign(x2 - x1) || 1, k = o.k || '';
      if (f === t) {
        el('path', { class: 'e ' + k, d: `M${x1 + 6} ${y - 10} h40 v20 h-40`, 'marker-end': `url(#ar-${k === 'dash' ? 'n' : k || 'n'})` }, gm);
        label(gm, x1 + 56 + measure(s) / 2 + 6, y, { t: s, k, n: o.n });
        return;
      }
      el('path', { class: 'e ' + k, d: `M${x1 + dir * 6} ${y} H${x2 - dir * 7}`, 'marker-end': `url(#ar-${k === 'dash' ? 'n' : k || 'n'})` }, gm);
      label(gm, (x1 + x2) / 2, y - 14, { t: s, k, n: o.n });
    });
  };
})();

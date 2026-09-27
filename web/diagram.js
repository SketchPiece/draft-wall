// Diagram boards: Mermaid text (*.mmd) read here, laid out with ELK and drawn as SVG in the draftwall diagram style.
// Runs as a classic script in the viewer (inlined at <!--diagram-->) and is imported by the CLI for parse() only,
// so it sets a global instead of exporting.
(() => {
  const KINDS = ['hl', 'add', 'del', 'ext'];
  const STEP = /^(\d{1,2})[.)](?:\s+|$)([\s\S]*)$/;
  const ELK_URL = 'https://cdn.jsdelivr.net/npm/elkjs@0.12.0/lib/elk.bundled.js';
  const FONTS_URL = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap';
  const SANS = '"IBM Plex Sans", system-ui, -apple-system, sans-serif';
  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

  // ---------- text ----------
  const ENT = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', '35': '#', '59': ';' };
  function clean(t) {
    t = (t ?? '').trim();
    if (t.length > 1 && t[0] === '"' && t.at(-1) === '"') t = t.slice(1, -1);
    t = t.replace(/#(\w+);/g, (m, k) => ENT[k] ?? m).replace(/&(quot|amp|lt|gt|nbsp);/g, (m, k) => ENT[k]);
    t = t.replace(/^`|`$/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/<\/?(?:b|i|strong|em|u|small|code)>/gi, '');
    return t.split(/<br\s*\/?>|\\n|\n/i).map(s => s.trim()).filter((s, i) => s || i === 0);
  }
  const step = label => { const m = STEP.exec(label ?? ''); return m ? { n: +m[1], label: m[2].trim() } : { n: null, label: (label ?? '').trim() }; };

  // ---------- parse ----------
  // Returns { type: 'flow' | 'seq', title, size, dir, nodes, edges, groups, lanes, rows, errors, refs } — refs maps a
  // source line to the node ids and edge indexes written on it, for the source panel.
  function parse(src) {
    const raw = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
    const d = { type: 'flow', title: null, size: null, dir: 'DOWN', nodes: new Map(), edges: [], groups: [], lanes: [], rows: [], errors: [], refs: new Map(), directives: [] };
    let i = 0;
    if (raw[0]?.trim() === '---') {
      for (i = 1; i < raw.length && raw[i].trim() !== '---'; i++) {
        const m = /^\s*(title|board)\s*:\s*(.*?)\s*$/.exec(raw[i]);
        if (m?.[1] === 'title') d.title = clean(m[2])[0] || null;
        if (m?.[1] === 'board') { const s = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/.exec(m[2]); if (s) d.size = [+s[1], +s[2]]; }
      }
      i++;
    }
    const lines = [];
    for (; i < raw.length; i++) {
      const t = raw[i].trim().replace(/;\s*$/, '');
      if (!t) continue;
      if (t.startsWith('%%')) {
        const m = /^%%\s*(hl|add|del|ext)\s*:\s*(.+)$/.exec(t);
        if (m) d.directives.push({ cls: m[1], ids: m[2].split(',').map(s => s.trim()).filter(Boolean) });
        continue;
      }
      lines.push({ t, n: i + 1 });
    }
    if (!lines.length) { d.errors.push({ line: 1, msg: 'The file is empty' }); return d; }
    const head = lines[0].t;
    let m;
    if ((m = /^(?:flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?$/i.exec(head))) { d.dir = dirOf(m[1] || 'TB'); parseFlow(d, lines.slice(1)); }
    else if (/^sequenceDiagram$/i.test(head)) { d.type = 'seq'; parseSeq(d, lines.slice(1)); }
    else if (/^stateDiagram(?:-v2)?$/i.test(head)) parseState(d, lines.slice(1));
    else if (/^erDiagram$/i.test(head)) { d.dir = 'RIGHT'; parseEr(d, lines.slice(1)); }
    else d.errors.push({ line: lines[0].n, msg: `Unknown diagram type "${head.split(/\s/)[0]}": use flowchart, sequenceDiagram, stateDiagram-v2 or erDiagram` });
    for (const { cls, ids } of d.directives) for (const id of ids) {
      const n = d.nodes.get(id) ?? d.lanes.find(l => l.id === id);
      if (n) n.cls.add(cls);
    }
    if (d.type === 'flow') {
      // Edges touching added or removed nodes take their color.
      for (const e of d.edges) {
        const a = d.nodes.get(e.from)?.cls, b = d.nodes.get(e.to)?.cls;
        if (a?.has('del') || b?.has('del')) e.cls = 'del';
        else if (!e.cls && (a?.has('add') || b?.has('add'))) e.cls = 'add';
      }
      if (!d.nodes.size && !d.errors.length) d.errors.push({ line: lines[0].n, msg: 'No nodes yet' });
    }
    return d;
  }
  const dirOf = s => ({ TB: 'DOWN', TD: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' })[s.toUpperCase()] ?? 'DOWN';
  function ref(d, line, kind, v) {
    let r = d.refs.get(line);
    if (!r) d.refs.set(line, r = { nodes: new Set(), edges: new Set() });
    r[kind].add(v);
  }
  function node(d, id, line, group) {
    let n = d.nodes.get(id);
    if (!n) d.nodes.set(id, n = { id, text: [id], shape: 'rect', cls: new Set(), line, group, defined: false });
    ref(d, line, 'nodes', id);
    return n;
  }
  function define(n, text, shape, line) {
    if (text) n.text = text;
    if (shape) n.shape = shape;
    if (!n.defined) { n.defined = true; n.line = line; }
  }
  function edge(d, e) { d.edges.push(e); ref(d, e.line, 'edges', d.edges.length - 1); }

  // flowchart
  const SHAPES = [
    ['(((', ')))', 'circle'], ['([', '])', 'stadium'], ['[(', ')]', 'cyl'], ['[[', ']]', 'rect'], ['((', '))', 'circle'],
    ['{{', '}}', 'hex'], ['[/', '/]', 'rect'], ['[/', '\\]', 'rect'], ['[\\', '\\]', 'rect'], ['[\\', '/]', 'rect'],
    ['[', ']', 'rect'], ['(', ')', 'round'], ['{', '}', 'diamond'], ['>', ']', 'rect'],
  ];
  const AT_SHAPES = { rect: 'rect', rounded: 'round', stadium: 'stadium', cyl: 'cyl', cylinder: 'cyl', db: 'cyl', database: 'cyl', circle: 'circle', circ: 'circle',
    diam: 'diamond', diamond: 'diamond', decision: 'diamond', hex: 'hex', hexagon: 'hex', prepare: 'hex' };
  const ID = /^[\p{L}\p{N}_]+(?:-(?![-.>=])[\p{L}\p{N}_]+)*/u;

  function parseFlow(d, lines) {
    const stack = [];
    let auto = 0;
    for (const { t, n: line } of lines) {
      let m;
      if ((m = /^subgraph\s+(.+)$/i.exec(t))) {
        const rest = m[1].trim();
        let id, title;
        if ((m = /^([\p{L}\p{N}_-]+)\s*\[(.*)\]$/u.exec(rest))) { id = m[1]; title = clean(m[2])[0]; }
        else if (/^".*"$/.test(rest)) { id = `sg${++auto}`; title = clean(rest)[0]; }
        else if (/^[\p{L}\p{N}_-]+$/u.test(rest)) id = title = rest;
        else { id = `sg${++auto}`; title = rest; }
        const g = { id, title, parent: stack.at(-1)?.id ?? null, line };
        d.groups.push(g); stack.push(g);
        ref(d, line, 'nodes', 'g:' + id);
        continue;
      }
      if (/^end$/i.test(t)) { if (!stack.pop()) d.errors.push({ line, msg: '"end" without a subgraph' }); continue; }
      if (/^(direction|classDef|style|linkStyle|click|accTitle|accDescr)\b/i.test(t)) continue;
      if ((m = /^class\s+([\p{L}\p{N}_,\s-]+?)\s+([\w-]+)$/u.exec(t))) {
        for (const id of m[1].split(',').map(s => s.trim())) if (KINDS.includes(m[2])) node(d, id, line, stack.at(-1)?.id ?? null).cls.add(m[2]);
        continue;
      }
      chain(d, t, line, stack.at(-1)?.id ?? null);
    }
    if (stack.length) d.errors.push({ line: stack.at(-1).line, msg: `subgraph "${stack.at(-1).title}" has no "end"` });
    // A subgraph used as an edge end is drawn as the group, not as a node of its own.
    const groups = new Set(d.groups.map(g => g.id));
    for (const [id, n] of d.nodes) if (groups.has(id) && !n.defined) d.nodes.delete(id);
    for (const e of d.edges) { e.fromGroup = groups.has(e.from) && !d.nodes.has(e.from); e.toGroup = groups.has(e.to) && !d.nodes.has(e.to); }
  }

  function chain(d, s, line, group) {
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const fail = () => {
      const rest = s.slice(i).trim();
      d.errors.push({ line, msg: rest ? `Can't read "${rest.slice(0, 24)}${rest.length > 24 ? '…' : ''}"` : 'The line ends where a node should be' });
      return null;
    };
    function ref1() {
      ws();
      const m = ID.exec(s.slice(i));
      if (!m) return null;
      i += m[0].length;
      const id = m[0], n = node(d, id, line, group);
      if (s.startsWith('@{', i)) {
        const close = s.indexOf('}', i);
        if (close < 0) return fail();
        const body = s.slice(i + 2, close); i = close + 1;
        const shape = /shape\s*:\s*["']?([\w-]+)/.exec(body)?.[1], label = /label\s*:\s*"([^"]*)"/.exec(body)?.[1];
        define(n, label != null ? clean(label) : null, AT_SHAPES[shape] ?? null, line);
      } else {
        for (const [open, close, shape] of SHAPES) {
          if (!s.startsWith(open, i)) continue;
          let j = i + open.length, text, end;
          while (s[j] === ' ') j++;
          if (s[j] === '"') {
            const q = s.indexOf('"', j + 1);
            if (q < 0) continue;
            let k = q + 1; while (s[k] === ' ') k++;
            if (!s.startsWith(close, k)) continue;
            text = s.slice(j, q + 1); end = k + close.length;
          } else {
            const k = s.indexOf(close, j);
            if (k < 0) continue;
            text = s.slice(j, k); end = k + close.length;
          }
          define(n, clean(text), shape, line); i = end;
          break;
        }
      }
      const c = /^:::([\w-]+)/.exec(s.slice(i));
      if (c) { i += c[0].length; if (KINDS.includes(c[1])) n.cls.add(c[1]); }
      return id;
    }
    function group1() {
      const ids = [];
      for (;;) {
        const id = ref1(); if (!id) break;
        ids.push(id); ws();
        if (s[i] === '&') { i++; continue; }
        break;
      }
      return ids;
    }
    function link() {
      ws();
      const rest = s.slice(i);
      let m = /^([<ox])?(--|==|-\.)\s+([^|]+?)\s*(-{2,}>|-{3,}|={2,}>|={3,}|\.+->|\.+-)(?![-=.>])/.exec(rest), label = null, tok;
      if (m) { tok = (m[1] ?? '') + m[2] + m[4]; label = m[3]; i += m[0].length; }
      else if ((m = /^([<ox])?(-{2,}|={2,}|-\.+-|~{3,})([>ox])?/.exec(rest))) {
        tok = m[0]; i += m[0].length;
        const l = /^\s*\|([^|]*)\|/.exec(s.slice(i));
        if (l) { label = l[1]; i += l[0].length; }
      } else return null;
      const st = step(clean(label ?? '').join(' '));
      return {
        style: tok.includes('~') ? 'none' : tok.includes('=') ? 'thick' : tok.includes('.') ? 'dash' : 'solid',
        start: /^[<ox]/.test(tok), end: /[>ox]$/.test(tok), label: st.label, n: st.n,
      };
    }
    let prev = group1();
    if (!prev.length) return fail();
    for (;;) {
      ws();
      if (i >= s.length) break;
      const l = link();
      if (!l) return fail();
      const next = group1();
      if (!next.length) return fail();
      if (l.style !== 'none') for (const a of prev) for (const b of next) {
        edge(d, { from: a, to: b, label: l.label, n: l.n, style: l.style === 'thick' ? 'solid' : l.style, cls: l.style === 'thick' ? 'hl' : null, start: l.start, end: l.end, line });
      }
      prev = next;
    }
  }

  // stateDiagram-v2, drawn as a flowchart
  function parseState(d, lines) {
    const stack = [];
    let note = false;
    const g = () => stack.at(-1) ?? null;
    const st = (id, line) => {
      if (id === '[*]') return null;
      const n = node(d, id, line, g()); if (n.shape === 'rect') n.shape = 'state';
      return n;
    };
    const pseudo = (kind, line) => {
      const id = `[*]${kind}:${g() ?? ''}`;
      const n = node(d, id, line, g()); n.shape = kind; n.text = ['']; n.defined = true;
      return id;
    };
    for (const { t, n: line } of lines) {
      let m;
      if (note) { if (/^end\s+note$/i.test(t)) note = false; continue; }
      if (/^note\s/i.test(t)) { if (!t.includes(':')) note = true; continue; }
      if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(t))) { if (!stack.length) d.dir = dirOf(m[1]); continue; }
      if (/^(classDef|style|--|accTitle|accDescr)\b/i.test(t)) continue;
      if ((m = /^class\s+([\w,\s-]+?)\s+([\w-]+)$/.exec(t))) { for (const id of m[1].split(',').map(s => s.trim())) if (KINDS.includes(m[2])) st(id, line)?.cls.add(m[2]); continue; }
      if (t === '}') { if (!stack.pop()) d.errors.push({ line, msg: '"}" without a composite state' }); continue; }
      if ((m = /^state\s+(?:"([^"]*)"\s+as\s+)?([\w-]+)\s*(<<\s*(choice|fork|join)\s*>>)?\s*(\{)?$/i.exec(t))) {
        const id = m[2];
        if (m[5]) {
          if (!d.groups.some(x => x.id === id)) d.groups.push({ id, title: m[1] ?? id, parent: g(), line });
          ref(d, line, 'nodes', 'g:' + id);
          stack.push(id);
        } else {
          const n = st(id, line);
          define(n, m[1] ? clean(m[1]) : null, m[4] ? (m[4].toLowerCase() === 'choice' ? 'choice' : 'fork') : null, line);
          if (m[4]) n.text = [''];
        }
        continue;
      }
      if ((m = /^(\[\*\]|[\w-]+)(?::::([\w-]+))?\s*-->\s*(\[\*\]|[\w-]+)(?::::([\w-]+))?\s*(?::\s*(.*))?$/.exec(t))) {
        const from = m[1] === '[*]' ? pseudo('start', line) : m[1], to = m[3] === '[*]' ? pseudo('end', line) : m[3];
        const a = st(from, line), b = st(to, line);
        if (m[2] && KINDS.includes(m[2])) a?.cls.add(m[2]);
        if (m[4] && KINDS.includes(m[4])) b?.cls.add(m[4]);
        const s1 = step(clean(m[5] ?? '').join(' '));
        edge(d, { from, to, label: s1.label, n: s1.n, style: 'solid', cls: null, start: false, end: true, line });
        continue;
      }
      if ((m = /^([\w-]+)\s*:\s*(.+)$/.exec(t))) {
        const n = st(m[1], line);
        if (!n.defined) define(n, null, null, line);
        n.text = [...n.text, ...clean(m[2])];
        continue;
      }
      if ((m = /^([\w-]+)(?::::([\w-]+))?$/.exec(t))) { const n = st(m[1], line); if (m[2] && KINDS.includes(m[2])) n.cls.add(m[2]); continue; }
      d.errors.push({ line, msg: `Can't read "${t.slice(0, 30)}"` });
    }
  }

  // erDiagram, drawn as a flowchart of tables
  const CARD_L = { '||': '1', '|o': '0..1', '}|': '1..n', '}o': 'n' }, CARD_R = { '||': '1', 'o|': '0..1', '|{': '1..n', 'o{': 'n' };
  function parseEr(d, lines) {
    let cur = null;
    const ent = (id, line) => { const n = node(d, id, line, null); if (n.shape !== 'table') { n.shape = 'table'; n.rows = []; } return n; };
    for (const { t, n: line } of lines) {
      let m;
      if (cur) {
        if (t === '}') { cur = null; continue; }
        if ((m = /^([\w\-[\]()<>,]+)\s+([\w-]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$/.exec(t))) cur.rows.push({ name: m[2], type: m[1], key: m[3] ?? '' });
        else d.errors.push({ line, msg: `Can't read the attribute "${t.slice(0, 30)}"` });
        continue;
      }
      if ((m = /^direction\s+(TB|TD|BT|LR|RL)$/i.exec(t))) { d.dir = dirOf(m[1]); continue; }
      if (/^(classDef|style)\b/i.test(t)) continue;
      if ((m = /^([\w-]+)(?:\s*\[\s*"?([^"\]]*)"?\s*\])?(?::::([\w-]+))?\s*\{$/.exec(t))) {
        cur = ent(m[1], line); define(cur, m[2] ? clean(m[2]) : null, null, line);
        if (m[3] && KINDS.includes(m[3])) cur.cls.add(m[3]);
        continue;
      }
      if ((m = /^([\w-]+)\s*(\|\||\|o|\}\||\}o)(--|\.\.)(\|\||o\||\|\{|o\{)\s*([\w-]+)\s*(?::\s*(.*))?$/.exec(t))) {
        ent(m[1], line); ent(m[5], line);
        const lb = step(clean(m[6] ?? '').join(' '));
        edge(d, { from: m[1], to: m[5], label: lb.label, n: lb.n, sub: `${CARD_L[m[2]]} : ${CARD_R[m[4]]}`, style: m[3] === '..' ? 'dash' : 'solid', cls: null, start: false, end: false, line });
        continue;
      }
      if ((m = /^([\w-]+)(?::::([\w-]+))?$/.exec(t))) { const n = ent(m[1], line); if (m[2] && KINDS.includes(m[2])) n.cls.add(m[2]); continue; }
      d.errors.push({ line, msg: `Can't read "${t.slice(0, 30)}"` });
    }
    if (cur) d.errors.push({ line: cur.line, msg: `"${cur.id}" has no closing "}"` });
  }

  // sequenceDiagram
  function parseSeq(d, lines) {
    const stack = [];
    let auto = false, count = 0, box = null;
    const lane = (id, line) => {
      let l = d.lanes.find(x => x.id === id);
      if (!l) { d.lanes.push(l = { id, text: [id], shape: 'rect', cls: new Set(), line, box: box?.id ?? null }); ref(d, line, 'nodes', id); }
      return l;
    };
    for (const { t, n: line } of lines) {
      let m;
      if (/^(title|accTitle|accDescr|links?|properties|details)\b/i.test(t)) continue;
      if (/^autonumber\b/i.test(t)) { auto = true; continue; }
      if ((m = /^(?:create\s+)?(participant|actor)\s+([^\s:]+?)(?:\s+as\s+(.+))?$/i.exec(t))) {
        const l = lane(m[2], line);
        if (m[3]) l.text = clean(m[3]);
        if (m[1].toLowerCase() === 'actor') l.shape = 'stadium';
        l.line = line; ref(d, line, 'nodes', l.id);
        continue;
      }
      if (/^destroy\s/i.test(t)) continue;
      if ((m = /^(activate|deactivate)\s+(\S+)$/i.exec(t))) { d.rows.push({ kind: m[1].toLowerCase(), lane: lane(m[2], line).id, line }); continue; }
      if ((m = /^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i.exec(t))) {
        const ids = m[2].split(',').map(s => s.trim());
        ids.forEach(id => lane(id, line));
        d.rows.push({ kind: 'note', side: m[1].toLowerCase(), lanes: ids, text: clean(m[3]), line });
        continue;
      }
      if ((m = /^box\b\s*(.*)$/i.exec(t))) {
        const title = m[1].replace(/^(?:rgba?\([^)]*\)|#\w+|transparent|aqua|\w+(?=\s))\s*/i, '').trim();
        box = { id: `box${d.groups.length}`, title: title || '', line }; d.groups.push(box); stack.push({ kind: 'box' });
        continue;
      }
      if ((m = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i.exec(t))) {
        const row = { kind: 'open', block: m[1].toLowerCase(), label: m[1].toLowerCase() === 'rect' ? '' : clean(m[2]).join(' '), line };
        d.rows.push(row); stack.push({ kind: 'block', row });
        continue;
      }
      if ((m = /^(else|and|option)\b\s*(.*)$/i.exec(t))) { d.rows.push({ kind: 'else', label: clean(m[2]).join(' '), line }); continue; }
      if (/^end$/i.test(t)) {
        const top = stack.pop();
        if (!top) d.errors.push({ line, msg: '"end" without a block' });
        else if (top.kind === 'box') box = null;
        else d.rows.push({ kind: 'close', line });
        continue;
      }
      if ((m = /^([^\s\-<>:+]+)\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)\s*([^\s:+-][^:]*?)\s*:\s?(.*)$/.exec(t))) {
        const a = lane(m[1], line).id, b = lane(m[4], line).id, arrow = m[2];
        const st = step(clean(m[5]).join(' '));
        const n = st.n ?? (auto ? ++count : null);
        const i = d.rows.length;
        d.rows.push({ kind: 'msg', from: a, to: b, label: st.label, n, style: arrow.includes('--') ? 'dash' : 'solid', end: !/^--?>$/.test(arrow), start: arrow.startsWith('<<'), line });
        ref(d, line, 'edges', i);
        if (m[3] === '+') d.rows.push({ kind: 'activate', lane: b, line });
        if (m[3] === '-') d.rows.push({ kind: 'deactivate', lane: a, line });
        continue;
      }
      d.errors.push({ line, msg: `Can't read "${t.slice(0, 30)}"` });
    }
    if (stack.some(s => s.kind === 'block')) d.errors.push({ line: stack.findLast(s => s.kind === 'block').row.line, msg: 'A block has no "end"' });
    if (!d.lanes.length && !d.errors.length) d.errors.push({ line: 1, msg: 'No participants yet' });
  }

  // ---------- browser: fonts, measuring, ELK ----------
  let ctx = null, fontsReady = null, elkReady = null;
  function ensureFonts() {
    if (fontsReady) return fontsReady;
    if (!document.querySelector('link[data-diagram-fonts]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = FONTS_URL; l.dataset.diagramFonts = '';
      document.head.appendChild(l);
    }
    const load = Promise.all([`600 15px ${SANS}`, `400 12px ${MONO}`, `500 12px ${MONO}`, `400 13px ${MONO}`].map(f => document.fonts.load(f).catch(() => null)));
    return fontsReady = Promise.race([load, new Promise(r => setTimeout(r, 2500))]);
  }
  function ensureElk() {
    if (elkReady) return elkReady;
    return elkReady = new Promise((resolve, reject) => {
      if (window.ELK) return resolve(new window.ELK());
      const s = document.createElement('script');
      s.src = ELK_URL; s.async = true;
      s.onload = () => resolve(new window.ELK());
      s.onerror = () => { elkReady = null; reject(new Error('The layout engine didn’t load')); };
      document.head.appendChild(s);
    });
  }
  function measure(text, font) {
    ctx ??= document.createElement('canvas').getContext('2d');
    ctx.font = font;
    return Math.ceil(ctx.measureText(text).width);
  }
  const F_TITLE = `600 15px ${SANS}`, F_SUB = `400 12px ${MONO}`, F_LABEL = `400 12px ${MONO}`, F_ROW = `400 13px ${MONO}`, F_GROUP = `500 11px ${MONO}`;
  const groupTitle = t => (t ?? '').toUpperCase();

  // Node box sizes from their text.
  function sizeOf(n) {
    if (n.shape === 'start') return [18, 18];
    if (n.shape === 'end') return [22, 22];
    if (n.shape === 'choice') return [30, 30];
    if (n.shape === 'fork') return [80, 8];
    if (n.shape === 'table') {
      const title = measure(n.text[0], F_TITLE) + 28;
      const rows = (n.rows ?? []).map(r => measure(r.name, F_ROW) + measure([r.type, r.key].filter(Boolean).join(' · '), F_SUB) + 52);
      return [Math.max(170, title, ...rows), 34 + (n.rows?.length ?? 0) * 24 + (n.rows?.length ? 8 : 0)];
    }
    const [title, ...sub] = n.text;
    const w = Math.max(measure(title, F_TITLE), ...sub.map(s => measure(s, F_SUB)));
    let W = Math.max(n.shape === 'circle' ? 60 : 140, w + 44), H = sub.length ? 44 + sub.length * 16 : 46;
    if (n.shape === 'stadium') W += 16;
    if (n.shape === 'hex') W += 30;
    if (n.shape === 'diamond') { W = Math.max(120, w * 1.5 + 40); H = Math.max(70, H * 1.5); }
    if (n.shape === 'circle') W = H = Math.max(W, H);
    if (n.shape === 'cyl') H += 12;
    return [Math.round(W), Math.round(H)];
  }
  const labelSize = e => {
    const text = [e.label, e.sub].filter(Boolean).join('  ');
    const w = (text ? measure(text, F_LABEL) + 12 : 0) + (e.n != null ? (text ? 28 : 22) : 0);
    return w ? [w, 20] : null;
  };

  // ---------- layout ----------
  // Returns { nodes: Map(id -> box), groups: Map(id -> box), edges: [{ points, label: {x, y} | null }] } in diagram units.
  async function layout(d) {
    await ensureFonts();
    if (d.type === 'seq') return layoutSeq(d);
    const elk = await ensureElk();
    const sizes = new Map([...d.nodes].map(([id, n]) => [id, sizeOf(n)]));
    const kids = new Map([[null, []]]);
    for (const g of d.groups) kids.set(g.id, []);
    const known = new Set(d.groups.map(g => g.id));
    for (const g of d.groups) (kids.get(known.has(g.parent) ? g.parent : null)).push({ group: g });
    for (const [id, n] of d.nodes) (kids.get(known.has(n.group) ? n.group : null)).push({ node: id });
    const titleW = g => measure(groupTitle(g.title), F_GROUP) + 40;
    const build = key => kids.get(key).map(k => k.node
      ? { id: 'n:' + k.node, width: sizes.get(k.node)[0], height: sizes.get(k.node)[1] }
      : { id: 'g:' + k.group.id, layoutOptions: { 'elk.padding': '[top=46,left=24,bottom=24,right=24]', 'elk.nodeSize.minimum': `(${titleW(k.group)}, 60)`, 'elk.nodeSize.constraints': 'MINIMUM_SIZE' }, children: build(k.group.id) });
    // A group as an edge end is laid out through its first node.
    const firstIn = gid => { for (const k of kids.get(gid) ?? []) { if (k.node) return k.node; const x = firstIn(k.group.id); if (x) return x; } return null; };
    const end = (id, isGroup) => isGroup ? firstIn(id) : id;
    const edges = [];
    d.edges.forEach((e, i) => {
      const a = end(e.from, e.fromGroup), b = end(e.to, e.toGroup);
      if (!a || !b || a === b) return;
      const ls = labelSize(e);
      edges.push({ id: 'e' + i, sources: ['n:' + a], targets: ['n:' + b], labels: ls ? [{ id: 'l' + i, text: 'x', width: ls[0], height: ls[1] }] : [] });
    });
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': d.dir, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': '70', 'elk.spacing.nodeNode': '40', 'elk.layered.spacing.edgeNodeBetweenLayers': '26',
        'elk.spacing.edgeEdge': '16', 'elk.spacing.edgeLabel': '4', 'elk.edgeLabels.inline': 'true',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.json.shapeCoords': 'ROOT', 'elk.json.edgeCoords': 'ROOT', 'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      },
      children: build(null), edges,
    };
    const out = await elk.layout(graph);
    const nodes = new Map(), groups = new Map();
    (function walk(list) {
      for (const c of list ?? []) {
        const box = { x: c.x, y: c.y, w: c.width, h: c.height };
        if (c.id.startsWith('n:')) nodes.set(c.id.slice(2), box); else groups.set(c.id.slice(2), box);
        walk(c.children);
      }
    })(out.children);
    const byId = new Map((out.edges ?? []).map(e => [e.id, e]));
    const routes = d.edges.map((e, i) => {
      const r = byId.get('e' + i), s = r?.sections?.[0];
      if (!s || e.fromGroup || e.toGroup) return null;
      const points = [[s.startPoint.x, s.startPoint.y], ...(s.bendPoints ?? []).map(p => [p.x, p.y]), [s.endPoint.x, s.endPoint.y]];
      const l = r.labels?.[0];
      return { points, label: l && Number.isFinite(l.x) ? onPath(points, l.x + l.width / 2, l.y + l.height / 2) : null };
    });
    return { nodes, groups, edges: routes };
  }

  function layoutSeq(d) {
    const W = new Map(d.lanes.map(l => [l.id, sizeOf(l)[0]]));
    const idx = new Map(d.lanes.map((l, i) => [l.id, i]));
    const x = []; let cx = 0;
    d.lanes.forEach((l, i) => { cx += i ? W.get(d.lanes[i - 1].id) / 2 + 48 + W.get(l.id) / 2 : W.get(l.id) / 2; x.push(cx); });
    const widen = (i, need) => { if (need > 0) for (let k = i; k < x.length; k++) x[k] += need; };
    for (const r of d.rows) {
      if (r.kind === 'msg') {
        const a = idx.get(r.from), b = idx.get(r.to), ls = labelSize(r)?.[0] ?? 0;
        if (a === b) widen(a + 1, ls + 70 - (x[a + 1] ?? Infinity) + x[a]);
        else { const lo = Math.min(a, b), hi = Math.max(a, b); widen(hi, ls + 40 - (x[hi] - x[lo])); }
      } else if (r.kind === 'note' && r.lanes.length === 1) {
        const w = Math.max(...r.text.map(s => measure(s, F_SUB))) + 28, i = idx.get(r.lanes[0]);
        if (r.side === 'right of') widen(i + 1, w + 30 - (x[i + 1] ?? Infinity) + x[i]);
      }
    }
    if (d.rows.some(r => r.kind === 'note' && r.lanes.length === 1 && r.side === 'left of' && idx.get(r.lanes[0]) === 0)) {
      const w = Math.max(...d.rows.filter(r => r.kind === 'note' && r.side === 'left of').flatMap(r => r.text.map(s => measure(s, F_SUB)))) + 58;
      for (let k = 0; k < x.length; k++) x[k] += Math.max(0, w - W.get(d.lanes[0].id) / 2);
    }
    const top = d.groups.length ? 34 : 0, headH = 46;
    let y = top + headH + 34;
    const rows = [], open = [], acts = [], active = new Map();
    for (const r of d.rows) {
      if (r.kind === 'msg') { rows.push({ r, y: y + 8 }); y += r.from === r.to ? 64 : 50; }
      else if (r.kind === 'note') { const h = 14 + r.text.length * 17; rows.push({ r, y, h }); y += h + 16; }
      else if (r.kind === 'open') { const b = { r, y, elses: [] }; open.push(b); rows.push(b); y += 44; }
      else if (r.kind === 'else') { open.at(-1)?.elses.push({ r, y }); y += 38; }
      else if (r.kind === 'close') { const b = open.pop(); if (b) b.end = y; y += 18; }
      else if (r.kind === 'activate') { (active.get(r.lane) ?? active.set(r.lane, []).get(r.lane)).push(y - 8); }
      else if (r.kind === 'deactivate') { const s = active.get(r.lane)?.pop(); if (s != null) acts.push({ lane: r.lane, y1: s - 14, y2: y - 20 }); }
    }
    for (const [lane, ys] of active) for (const s of ys) acts.push({ lane, y1: s - 14, y2: y - 8 });
    for (const b of open) b.end = y;
    const bottom = y + 10;
    // Blocks span the lanes their messages touch.
    for (const row of rows) if (row.r.kind === 'open') {
      const inside = rows.filter(o => o.r.kind === 'msg' && o.y > row.y && o.y < row.end);
      const ls = inside.flatMap(o => [idx.get(o.r.from), idx.get(o.r.to)]);
      const lo = ls.length ? Math.min(...ls) : 0, hi = ls.length ? Math.max(...ls) : d.lanes.length - 1;
      row.x1 = x[lo] - Math.max(W.get(d.lanes[lo].id) / 2, 60) + 6; row.x2 = x[hi] + Math.max(W.get(d.lanes[hi].id) / 2, 60) - 6;
      if (inside.some(o => o.r.from === o.r.to && idx.get(o.r.from) === hi)) row.x2 = Math.max(row.x2, x[hi] + (labelSize(inside.find(o => o.r.from === o.r.to).r)?.[0] ?? 0) + 70);
    }
    const nodes = new Map(d.lanes.map((l, i) => [l.id, { x: x[i] - W.get(l.id) / 2, y: top, w: W.get(l.id), h: headH }]));
    const boxes = d.groups.map(g => {
      const ls = d.lanes.filter(l => l.box === g.id).map(l => nodes.get(l.id));
      if (!ls.length) return null;
      const x1 = Math.min(...ls.map(b => b.x)) - 16, x2 = Math.max(...ls.map(b => b.x + b.w)) + 16;
      return { g, x: x1, y: 0, w: x2 - x1, h: bottom + 12 };
    }).filter(Boolean);
    return { nodes, x: new Map(d.lanes.map((l, i) => [l.id, x[i]])), rows, acts, bottom, boxes, headH, top };
  }

  // ---------- draw ----------
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    parent?.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, cls, anchor = 'middle') {
    const t = el('text', { x, y, class: cls, 'text-anchor': anchor, 'dominant-baseline': 'central' }, parent);
    t.textContent = str;
    return t;
  }
  function defs(svg) {
    const id = 'dg' + (++uid), d = el('defs', {}, svg);
    for (const k of ['n', 'hl', 'add', 'del']) {
      const m = el('marker', { id: `${id}-${k}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 10, markerHeight: 10, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, d);
      el('path', { d: 'M1 1.5 9 5 1 8.5Z', class: 'mk ' + k }, m);
    }
    return k => `url(#${id}-${k || 'n'})`;
  }
  function round(pts, r = 10) {
    let s = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
      const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y);
      if (!l1 || !l2) continue;
      const rr = Math.min(r, l1 / 2, l2 / 2);
      s += ` L${x - (x - px) / l1 * rr} ${y - (y - py) / l1 * rr} Q${x} ${y} ${x + (nx - x) / l2 * rr} ${y + (ny - y) / l2 * rr}`;
    }
    const l = pts.at(-1);
    return s + ` L${l[0]} ${l[1]}`;
  }
  function midpoint(pts) {
    let best = -1, at = [pts[0][0], pts[0][1]];
    for (let i = 0; i < pts.length - 1; i++) {
      const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      if (l > best) { best = l; at = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; }
    }
    return { x: at[0], y: at[1] };
  }
  // ELK puts labels beside the edge; they read better sitting on it, at the nearest point.
  function onPath(pts, x, y) {
    let best = null, bd = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      const px = ax + t * dx, py = ay + t * dy, dd = Math.hypot(px - x, py - y);
      if (dd < bd) { bd = dd; best = { x: px, y: py }; }
    }
    return bd < 60 ? best : null;
  }
  // Own orthogonal route between two boxes, used once a node has been moved by hand.
  function route(A, B) {
    const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2, dx = bx - ax, dy = by - ay;
    const side = (B.x >= A.x + A.w - 4 || B.x + B.w <= A.x + 4) && Math.abs(dx) > Math.abs(dy) * 0.6;
    if (side) {
      const p = [dx > 0 ? A.x + A.w : A.x, ay], q = [dx > 0 ? B.x : B.x + B.w, by];
      if (Math.abs(p[1] - q[1]) < 1) return [p, [q[0], p[1]]];
      const mx = (p[0] + q[0]) / 2;
      return [p, [mx, p[1]], [mx, q[1]], q];
    }
    const p = [ax, dy > 0 ? A.y + A.h : A.y], q = [bx, dy > 0 ? B.y : B.y + B.h];
    if (Math.abs(p[0] - q[0]) < 1) return [p, [p[0], q[1]]];
    const my = (p[1] + q[1]) / 2;
    return [p, [p[0], my], [q[0], my], q];
  }

  function drawNode(g, n, b) {
    const cls = [...n.cls].join(' ');
    const grp = el('g', { class: `n ${cls}`, 'data-id': n.id, 'data-line': n.line }, g);
    const { x, y, w, h } = b;
    if (n.shape === 'start') { el('circle', { cx: x + w / 2, cy: y + h / 2, r: w / 2, class: 'n-solid' }, grp); return grp; }
    if (n.shape === 'end') { el('circle', { cx: x + w / 2, cy: y + h / 2, r: w / 2 - 1, class: 'n-box' }, grp); el('circle', { cx: x + w / 2, cy: y + h / 2, r: w / 2 - 6, class: 'n-solid' }, grp); return grp; }
    if (n.shape === 'fork') { el('rect', { x, y, width: w, height: h, rx: 3, class: 'n-solid' }, grp); return grp; }
    if (n.shape === 'choice') { el('path', { d: `M${x + w / 2} ${y}L${x + w} ${y + h / 2}L${x + w / 2} ${y + h}L${x} ${y + h / 2}Z`, class: 'n-box' }, grp); return grp; }
    if (n.shape === 'cyl') {
      const ry = 7;
      el('path', { class: 'n-box', d: `M${x} ${y + ry}a${w / 2} ${ry} 0 0 0 ${w} 0a${w / 2} ${ry} 0 0 0 ${-w} 0v${h - 2 * ry}a${w / 2} ${ry} 0 0 0 ${w} 0v${-(h - 2 * ry)}` }, grp);
    } else if (n.shape === 'diamond') {
      el('path', { class: 'n-box', d: `M${x + w / 2} ${y}L${x + w} ${y + h / 2}L${x + w / 2} ${y + h}L${x} ${y + h / 2}Z`, 'stroke-linejoin': 'round' }, grp);
    } else if (n.shape === 'hex') {
      const k = Math.min(18, h / 2);
      el('path', { class: 'n-box', d: `M${x + k} ${y}H${x + w - k}L${x + w} ${y + h / 2}L${x + w - k} ${y + h}H${x + k}L${x} ${y + h / 2}Z`, 'stroke-linejoin': 'round' }, grp);
    } else if (n.shape === 'circle') {
      el('circle', { class: 'n-box', cx: x + w / 2, cy: y + h / 2, r: w / 2 }, grp);
    } else {
      const rx = n.shape === 'stadium' ? h / 2 : n.shape === 'round' || n.shape === 'state' ? 14 : 8;
      el('rect', { class: 'n-box', x, y, width: w, height: h, rx }, grp);
    }
    if (n.shape === 'table') {
      el('line', { class: 'n-rule', x1: x, x2: x + w, y1: y + 34, y2: y + 34 }, grp);
      text(grp, x + 14, y + 17, n.text[0], 'n-t', 'start');
      (n.rows ?? []).forEach((r, i) => {
        text(grp, x + 14, y + 50 + i * 24, r.name, 'n-f', 'start');
        text(grp, x + w - 14, y + 50 + i * 24, [r.type, r.key].filter(Boolean).join(' · '), 'n-s', 'end');
      });
    } else {
      const [title, ...sub] = n.text, cy = y + h / 2 + (n.shape === 'cyl' ? 5 : 0), total = sub.length * 16;
      text(grp, x + w / 2, cy - total / 2, title, 'n-t');
      sub.forEach((s, i) => text(grp, x + w / 2, cy - total / 2 + 19 + i * 16, s, 'n-s'));
    }
    if (n.cls.has('add') || n.cls.has('del')) {
      const k = n.cls.has('del') ? 'del' : 'add';
      el('circle', { cx: x + w, cy: y, r: 10, class: 'badge-bg ' + k }, grp);
      text(grp, x + w, y + 0.5, k === 'add' ? '+' : '−', 'badge');
    }
    return grp;
  }
  function drawLabel(g, at, e) {
    const t = [e.label, e.sub].filter(Boolean);
    if (!t.length && e.n == null) return;
    const lb = el('g', { class: 'e-lb ' + (e.cls ?? '') }, g);
    const tw = t.length ? measure(t.join('  '), F_LABEL) + 12 : 0, w = tw + (e.n != null ? (tw ? 28 : 22) : 0);
    let x = at.x - w / 2;
    if (e.n != null) {
      el('circle', { cx: x + 11, cy: at.y, r: 11, class: 'step-bg' }, lb);
      text(lb, x + 11, at.y + 0.5, String(e.n), 'step');
      x += tw ? 28 : 22;
    }
    if (tw) {
      el('rect', { x, y: at.y - 10, width: tw, height: 20, rx: 4, class: 'e-bg' }, lb);
      const tx = text(lb, x + 6, at.y, '', 'e-t', 'start');
      if (e.label) { const s = el('tspan', {}, tx); s.textContent = e.label; }
      if (e.sub) { const s = el('tspan', { class: 'e-sub' }, tx); s.textContent = (e.label ? '  ' : '') + e.sub; }
    }
  }

  // Draws a laid-out diagram. `moved` holds hand-placed node positions { id: [x, y] }.
  // Returns the <svg> sized to fill its box (viewBox fits the drawing, never enlarged beyond maxScale).
  function draw(d, lay, { moved = {}, width, height, maxScale = 1.4, viewBox = null } = {}) {
    const svg = el('svg', { class: 'dgm', xmlns: NS, width: '100%', height: '100%', preserveAspectRatio: 'xMidYMid meet' });
    const mk = defs(svg);
    const gGroups = el('g', {}, svg), gEdges = el('g', {}, svg), gNodes = el('g', {}, svg), gLabels = el('g', {}, svg);
    const ext = [];
    const grow = (x, y, w = 0, h = 0) => ext.push([x, y, x + w, y + h]);
    if (d.type === 'seq') drawSeq(d, lay, { gGroups, gEdges, gNodes, gLabels, mk, grow });
    else {
      const boxes = new Map();
      for (const [id, b] of lay.nodes) boxes.set(id, moved[id] ? { ...b, x: moved[id][0], y: moved[id][1] } : b);
      const isMoved = id => !!moved[id];
      // Groups grow around moved nodes.
      const gboxes = new Map();
      const kidsOf = gid => [...d.nodes.values()].filter(n => n.group === gid).map(n => boxes.get(n.id)).concat(d.groups.filter(g => g.parent === gid).map(g => gbox(g)));
      const touched = gid => [...d.nodes.values()].some(n => n.group === gid && isMoved(n.id)) || d.groups.some(g => g.parent === gid && touched(g.id));
      function gbox(g) {
        if (gboxes.has(g.id)) return gboxes.get(g.id);
        let b = lay.groups.get(g.id);
        if (b && touched(g.id)) {
          const ks = kidsOf(g.id).filter(Boolean);
          const x1 = Math.min(...ks.map(k => k.x)) - 24, y1 = Math.min(...ks.map(k => k.y)) - 46, x2 = Math.max(...ks.map(k => k.x + k.w)) + 24, y2 = Math.max(...ks.map(k => k.y + k.h)) + 24;
          b = { x: x1, y: y1, w: Math.max(x2 - x1, b.w), h: y2 - y1 };
        }
        gboxes.set(g.id, b);
        return b;
      }
      for (const g of d.groups) {
        const b = gbox(g); if (!b) continue;
        const grp = el('g', { class: 'grp', 'data-id': 'g:' + g.id, 'data-line': g.line }, gGroups);
        el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14, class: 'grp-box' }, grp);
        text(grp, b.x + 16, b.y + 20, groupTitle(g.title), 'grp-t', 'start');
        grow(b.x, b.y, b.w, b.h);
      }
      d.edges.forEach((e, i) => {
        const A = e.fromGroup ? gboxes.get(e.from) : boxes.get(e.from), B = e.toGroup ? gboxes.get(e.to) : boxes.get(e.to);
        if (!A || !B) return;
        let r = lay.edges[i];
        if (!r || isMoved(e.from) || isMoved(e.to)) r = { points: route(A, B), label: null };
        const pts = r.points, k = e.cls || 'n';
        const path = el('path', { d: round(pts), class: `e ${e.cls ?? ''} ${e.style === 'dash' ? 'dash' : ''}`, 'data-edge': i, 'data-line': e.line,
          'marker-end': e.end ? mk(k) : null, 'marker-start': e.start ? mk(k) : null }, gEdges);
        void path;
        for (const p of pts) grow(p[0], p[1]);
        const at = r.label ?? midpoint(pts);
        drawLabel(gLabels, at, e);
        const ls = labelSize(e); if (ls) grow(at.x - ls[0] / 2, at.y - 10, ls[0], 20);
      });
      for (const [id, n] of d.nodes) { const b = boxes.get(id); if (!b) continue; drawNode(gNodes, n, b); grow(b.x, b.y - (n.cls.has('add') || n.cls.has('del') ? 10 : 0), b.w + 10, b.h + 10); }
    }
    // Fit: pad the drawing, then never enlarge beyond maxScale inside the board.
    const x1 = Math.min(...ext.map(e => e[0])), y1 = Math.min(...ext.map(e => e[1])), x2 = Math.max(...ext.map(e => e[2])), y2 = Math.max(...ext.map(e => e[3]));
    let vb = viewBox;
    if (!vb) {
      const pad = 40;
      let vx = x1 - pad, vy = y1 - pad, vw = x2 - x1 + pad * 2, vh = y2 - y1 + pad * 2;
      if (width && height) {
        const s = Math.min(width / vw, height / vh);
        if (s > maxScale) { const nw = width / maxScale, nh = height / maxScale; vx -= (nw - vw) / 2; vy -= (nh - vh) / 2; vw = nw; vh = nh; }
      }
      vb = [vx, vy, vw, vh].map(v => Math.round(v * 10) / 10);
    }
    svg.setAttribute('viewBox', vb.join(' '));
    svg.dataset.viewBox = vb.join(' ');
    return svg;
  }

  function drawSeq(d, lay, { gGroups, gEdges, gNodes, gLabels, mk, grow }) {
    for (const b of lay.boxes) {
      const grp = el('g', { class: 'grp', 'data-line': b.g.line }, gGroups);
      el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14, class: 'grp-box' }, grp);
      if (b.g.title) text(grp, b.x + 16, b.y + 18, groupTitle(b.g.title), 'grp-t', 'start');
      grow(b.x, b.y, b.w, b.h);
    }
    for (const l of d.lanes) {
      const b = lay.nodes.get(l.id), cx = lay.x.get(l.id);
      el('line', { x1: cx, x2: cx, y1: b.y + b.h, y2: lay.bottom, class: 'life' }, gGroups);
      drawNode(gNodes, l, b); grow(b.x, b.y, b.w, b.h + 10);
    }
    for (const a of lay.acts) { const cx = lay.x.get(a.lane); el('rect', { x: cx - 5, y: a.y1, width: 10, height: Math.max(12, a.y2 - a.y1), rx: 2, class: 'act' }, gEdges); }
    for (const row of lay.rows) {
      const r = row.r;
      if (r.kind === 'open') {
        const grp = el('g', { class: 'blk', 'data-line': r.line }, gGroups);
        el('rect', { x: row.x1, y: row.y, width: row.x2 - row.x1, height: row.end - row.y, rx: 8, class: 'blk-box' }, grp);
        const kw = measure(r.block, F_GROUP) + 16;
        el('path', { d: `M${row.x1} ${row.y + 8}a8 8 0 0 1 8 -8H${row.x1 + kw}v14l-6 8H${row.x1}Z`, class: 'blk-tab' }, grp);
        text(grp, row.x1 + 8, row.y + 11, r.block.toUpperCase(), 'grp-t', 'start');
        // Block labels sit on paper above lifelines and activation bars.
        const tag = (x, y, str) => {
          const w = measure(str, `500 12px ${MONO}`) + 12, lb = el('g', { class: 'e-lb' }, gLabels);
          el('rect', { x: x - 6, y: y - 10, width: w, height: 20, rx: 4, class: 'e-bg' }, lb);
          text(lb, x, y, str, 'blk-t', 'start');
        };
        if (r.label) tag(row.x1 + kw + 10, row.y + 12, `[${r.label}]`);
        for (const e of row.elses) {
          el('line', { x1: row.x1, x2: row.x2, y1: e.y, y2: e.y, class: 'blk-sep' }, grp);
          if (e.r.label) tag(row.x1 + 10, e.y + 14, `[${e.r.label}]`);
        }
        grow(row.x1, row.y, row.x2 - row.x1, row.end - row.y);
      } else if (r.kind === 'note') {
        const xs = r.lanes.map(id => lay.x.get(id)), w = Math.max(...r.text.map(s => measure(s, F_SUB))) + 28;
        let x1;
        if (r.side === 'over') { const lo = Math.min(...xs), hi = Math.max(...xs); const W = Math.max(w, hi - lo + 60); x1 = (lo + hi) / 2 - W / 2; row.w = W; }
        else { x1 = r.side === 'left of' ? xs[0] - 20 - w : xs[0] + 20; row.w = w; }
        const grp = el('g', { class: 'note', 'data-line': r.line }, gNodes);
        el('rect', { x: x1, y: row.y, width: row.w, height: row.h, rx: 6, class: 'note-box' }, grp);
        r.text.forEach((s, i) => text(grp, x1 + row.w / 2, row.y + 15 + i * 17, s, 'n-s'));
        grow(x1, row.y, row.w, row.h);
      } else if (r.kind === 'msg') {
        const x1 = lay.x.get(r.from), x2 = lay.x.get(r.to), y = row.y, k = r.cls || 'n';
        const i = d.rows.indexOf(r);
        let pts, at;
        if (r.from === r.to) { pts = [[x1 + 6, y - 10], [x1 + 46, y - 10], [x1 + 46, y + 10], [x1 + 6, y + 10]]; const ls = labelSize(r); at = { x: x1 + 56 + (ls?.[0] ?? 0) / 2, y }; }
        else { const dir = Math.sign(x2 - x1); pts = [[x1 + dir * 6, y], [x2 - dir * 6, y]]; at = { x: (x1 + x2) / 2, y: y - 15 }; }
        el('path', { d: round(pts, 6), class: `e ${r.style === 'dash' ? 'dash' : ''}`, 'data-edge': i, 'data-line': r.line, 'marker-end': r.end ? mk(k) : null, 'marker-start': r.start ? mk(k) : null }, gEdges);
        drawLabel(gLabels, at, r);
        for (const p of pts) grow(p[0], p[1]);
        const ls = labelSize(r); if (ls) grow(at.x - ls[0] / 2, at.y - 10, ls[0], 20);
      }
    }
    grow(0, lay.bottom);
  }

  // Source text with light highlighting, one <span class="ln"> per line.
  const KW = /\b(flowchart|graph|subgraph|end|direction|classDef|class|style|linkStyle|click|sequenceDiagram|stateDiagram-v2|stateDiagram|erDiagram|participant|actor|autonumber|activate|deactivate|loop|alt|else|opt|par|and|critical|break|rect|box|note|over|left of|right of|state|as|TB|TD|BT|LR|RL)\b/;
  const TOKENS = new RegExp(`(:::[\\w-]+)|("[^"]*")|(\\|[^|]*\\|)|(\\[[^\\]]*\\]|\\([^)]*\\)|\\{[^}]*\\})|${KW.source}`, 'g');
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  function highlight(src) {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
    let front = lines[0]?.trim() === '---';
    return lines.map((l, i) => {
      if (front) { if (i > 0 && l.trim() === '---') front = false; return `<span class="c">${esc(l)}</span>`; }
      if (l.trim().startsWith('%%')) return `<span class="c">${esc(l)}</span>`;
      let out = '', last = 0;
      for (const m of l.matchAll(TOKENS)) {
        out += esc(l.slice(last, m.index));
        const cls = m[1] ? 'a' : m[2] || m[3] || m[4] ? 's' : 'k';
        out += `<span class="${cls}">${esc(m[0])}</span>`;
        last = m.index + m[0].length;
      }
      return out + esc(l.slice(last));
    });
  }

  globalThis.draftwallDiagram = { parse, layout, draw, highlight, ensureFonts };
})();

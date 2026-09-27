// The push.mmd example shared by the round-2 boards: its source listing and its drawn layout.
window.PUSH_SRC = [
  '<span class="c">---</span>',
  '<span class="c">title: Push: CLI → Railway</span>',
  '<span class="c">---</span>',
  '<span class="k">flowchart</span> LR',
  '  <span class="k">subgraph</span> m [Your machine]',
  '    files[(<span class="s">Canvas folder</span>)]',
  '    cli([<span class="s">canvas push</span>])',
  '  <span class="k">end</span>',
  '  <span class="k">subgraph</span> r [Railway]',
  '    api[<span class="s">Hosted app</span>] --&gt;|<span class="s">2.</span>| access',
  '    access[<span class="s">Access check</span>]<span class="a">:::hl</span>',
  '    access --&gt;|<span class="s">3. commit</span>| vol[(<span class="s">Volume</span>)]',
  '  <span class="k">end</span>',
  '  files --&gt;|<span class="s">reads</span>| cli',
  '  cli --&gt;|<span class="s">1. PUT files/*</span>| api',
  '  you([<span class="s">You</span>])<span class="a">:::ext</span> --&gt; viewer[<span class="s">Viewer</span>]',
  '  viewer -.-&gt;|<span class="s">GET canvases/:id</span>| api',
];
window.listing = (el, on) => {
  el.innerHTML = PUSH_SRC.map((l, i) => {
    const row = `<span class="ln">${i + 1}</span>${l}`;
    return i + 1 === on ? `<span class="on">${row}</span>` : row;
  }).join('\n');
};
window.PUSH = sel => ({
  groups: [
    { x: 30, y: 40, w: 300, h: 450, t: 'Your machine' },
    { x: 400, y: 40, w: 570, h: 450, t: 'Railway' },
  ],
  nodes: {
    files: { x: 70, y: 100, w: 220, h: 72, t: 'Canvas folder', s: '*.html · canvas.json', shape: 'store' },
    cli: { x: 70, y: 300, w: 220, h: 60, t: 'canvas push', s: 'CLI · agent', shape: 'actor' },
    api: { x: 440, y: 300, w: 220, h: 60, t: 'Hosted app', s: 'Hono on Node' },
    access: { x: 720, y: 300, w: 220, h: 60, t: 'Access check', s: 'owner only', k: 'hl' + (sel === 'access' ? ' sel' : '') },
    vol: { x: 720, y: 96, w: 220, h: 76, t: 'Volume', s: '/data/<id>/state.json', shape: 'store' },
    viewer: { x: 440, y: 580, w: 220, h: 60, t: 'Viewer', s: '/c/:id' },
    you: { x: 70, y: 580, w: 220, h: 60, t: 'You', s: 'phone · Mac', shape: 'actor', k: 'ext' },
  },
  edges: [
    ['files', 'cli', { t: 'reads' }],
    ['cli', 'api', { t: 'PUT files/*', n: 1, k: 'hl' }],
    ['api', 'access', { n: 2, k: 'hl' }],
    ['access', 'vol', { t: 'commit', n: 3, k: 'hl' }],
    ['you', 'viewer', { t: 'opens link' }],
    ['viewer', 'api', { t: 'GET canvases/:id', k: 'dash' }],
  ],
});

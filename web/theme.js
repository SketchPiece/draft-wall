// Color themes: the draftwall default plus T3 Code's built-in themes and our custom ones (~/.t3/userdata/themes).
// Inlined into each page's <head> by scripts/embed.mjs so the theme applies before first paint.
// The choice lives in localStorage: { id, mode: 'system' | 'light' | 'dark' }. Themes without a light variant stay dark.
(() => {
  const THEMES = {
  'default': { label: 'Draftwall',
    light: { 'bg': '#f3f3f4', 'panel': '#ffffff', 'panel-2': '#fafafa', 'hover': '#f0f0f1', 'pressed': '#e7e7e9', 'line': 'rgba(0,0,0,.08)', 'line-2': 'rgba(0,0,0,.15)', 'text': '#18181b', 'muted': '#6b6b73', 'accent': '#2f63e6', 'accent-fg': '#ffffff', 'danger': '#d93036' },
    dark: { 'bg': '#0a0a0a', 'panel': '#111111', 'panel-2': '#161616', 'hover': '#1f1f1f', 'pressed': '#262626', 'line': 'rgba(255,255,255,.08)', 'line-2': 'rgba(255,255,255,.14)', 'text': '#ececec', 'muted': '#8e8e8e', 'accent': '#346bf1', 'accent-fg': '#ffffff', 'danger': '#e5484d' } },
  't3-chat': { label: "T3 Chat",
    light: { 'bg': 'oklch(0.982446 0.010114 325.653)', 'panel': 'oklch(0.988235 0.005049 325.615)', 'panel-2': 'oklch(1 0 0)', 'hover': 'oklch(0.884525 0.041658 337.177)', 'pressed': 'oklch(0.939552 0.024286 321.664)', 'line': 'oklch(0.923531 0.021247 328.096)', 'line-2': 'oklch(0.851713 0.055822 336.6)', 'text': 'oklch(0.325698 0.116116 325.037)', 'muted': 'oklch(0.494754 0.190937 354.544)', 'accent': 'oklch(0.591646 0.217985 0.584)', 'accent-fg': 'oklch(1 0 0)', 'danger': 'oklch(0.627117 0.248974 7.734)' },
    dark: { 'bg': 'oklch(0.22813 0.020366 307.469)', 'panel': 'oklch(0.279864 0.021572 309.532)', 'panel-2': 'oklch(0.154761 0.01316 338.901)', 'hover': 'oklch(0.364912 0.050794 308.491)', 'pressed': 'oklch(0.313674 0.030572 310.061)', 'line': 'oklch(0.266943 0.015262 302.425)', 'line-2': 'oklch(0.266817 0.02897 344.461)', 'text': 'oklch(0.980735 0.004092 301.426)', 'muted': 'oklch(0.880303 0.03077 342.696)', 'accent': 'oklch(0.460685 0.185347 4.099)', 'accent-fg': 'oklch(0.901233 0.057189 343.694)', 'danger': 'oklch(0.458704 0.169677 3.815)' } },
  'grove': { label: "Grove",
    light: { 'bg': 'oklch(0.972369 0.005497 157.15)', 'panel': 'oklch(0.949276 0.004496 159.002)', 'panel-2': 'oklch(0.932695 0.003778 160.944)', 'hover': 'oklch(0.909438 0.021521 164.612)', 'pressed': 'oklch(0.936464 0.014601 163.554)', 'line': 'oklch(0.864831 0.01312 167.255)', 'line-2': 'oklch(0.829746 0.016084 168.234)', 'text': 'oklch(0.222003 0.03479 328.979)', 'muted': 'oklch(0.540472 0.014944 326.176)', 'accent': 'oklch(0.523295 0.112292 158.089)', 'accent-fg': 'oklch(0.990339 0.008411 325.64)', 'danger': 'oklch(0.637823 0.237287 25.436)' },
    dark: { 'bg': 'oklch(0.260865 0.02152 162.75)', 'panel': 'oklch(0.363192 0.016572 165.32)', 'panel-2': 'oklch(0.411828 0.014378 166.627)', 'hover': 'oklch(0.437021 0.060312 158.962)', 'pressed': 'oklch(0.380487 0.048313 159.608)', 'line': 'oklch(0.457475 0.044046 160.971)', 'line-2': 'oklch(0.519849 0.049896 160.863)', 'text': 'oklch(0.990339 0.008411 325.64)', 'muted': 'oklch(0.666747 0.004239 187.292)', 'accent': 'oklch(0.796228 0.133058 157.319)', 'accent-fg': 'oklch(0.222003 0.03479 328.979)', 'danger': 'oklch(0.655108 0.221148 23.473)' } },
  'ocean': { label: "Ocean",
    light: { 'bg': 'oklch(0.974199 0.002856 241.597)', 'panel': 'oklch(0.951058 0.002962 258.339)', 'panel-2': 'oklch(0.934442 0.003181 269.1)', 'hover': 'oklch(0.91295 0.018827 241.836)', 'pressed': 'oklch(0.939254 0.01193 241.729)', 'line': 'oklch(0.867646 0.013482 252.362)', 'line-2': 'oklch(0.832939 0.017389 252.598)', 'text': 'oklch(0.222003 0.03479 328.979)', 'muted': 'oklch(0.541555 0.017468 323.531)', 'accent': 'oklch(0.536684 0.120219 247.01)', 'accent-fg': 'oklch(0.990339 0.008411 325.64)', 'danger': 'oklch(0.637823 0.237287 25.436)' },
    dark: { 'bg': 'oklch(0.242641 0.024125 250.573)', 'panel': 'oklch(0.348439 0.019942 253.696)', 'panel-2': 'oklch(0.398517 0.018232 255.72)', 'hover': 'oklch(0.413315 0.051874 243.855)', 'pressed': 'oklch(0.358725 0.043145 244.911)', 'line': 'oklch(0.438653 0.039496 245.44)', 'line-2': 'oklch(0.500905 0.043574 244.781)', 'text': 'oklch(0.990339 0.008411 325.64)', 'muted': 'oklch(0.652227 0.01149 273.31)', 'accent': 'oklch(0.758933 0.105833 241.548)', 'accent-fg': 'oklch(0.222003 0.03479 328.979)', 'danger': 'oklch(0.655108 0.221148 23.473)' } },
  'ember': { label: "Ember",
    light: { 'bg': 'oklch(0.976527 0.002685 60.725)', 'panel': 'oklch(0.953321 0.002701 42.266)', 'panel-2': 'oklch(0.936659 0.002879 29.96)', 'hover': 'oklch(0.916502 0.01832 49.597)', 'pressed': 'oklch(0.942267 0.01151 50.785)', 'line': 'oklch(0.870631 0.013204 39.431)', 'line-2': 'oklch(0.836213 0.017153 38.661)', 'text': 'oklch(0.222003 0.03479 328.979)', 'muted': 'oklch(0.543023 0.017316 331.964)', 'accent': 'oklch(0.552831 0.129438 44.656)', 'accent-fg': 'oklch(0.990339 0.008411 325.64)', 'danger': 'oklch(0.637823 0.237287 25.436)' },
    dark: { 'bg': 'oklch(0.245899 0.019144 42.044)', 'panel': 'oklch(0.351262 0.01565 37.592)', 'panel-2': 'oklch(0.401111 0.014308 34.896)', 'hover': 'oklch(0.416048 0.055354 50.484)', 'pressed': 'oklch(0.361499 0.044052 49.515)', 'line': 'oklch(0.44099 0.040202 48.807)', 'line-2': 'oklch(0.503003 0.045721 49.44)', 'text': 'oklch(0.990339 0.008411 325.64)', 'muted': 'oklch(0.654017 0.009505 13.287)', 'accent': 'oklch(0.762174 0.124117 52.082)', 'accent-fg': 'oklch(0.222003 0.03479 328.979)', 'danger': 'oklch(0.655108 0.221148 23.473)' } },
  'iris': { label: "Iris",
    light: { 'bg': 'oklch(0.976531 0.003855 303.226)', 'panel': 'oklch(0.953326 0.004536 307.676)', 'panel-2': 'oklch(0.936665 0.005041 310.132)', 'hover': 'oklch(0.914882 0.022965 299.986)', 'pressed': 'oklch(0.941387 0.014687 300.474)', 'line': 'oklch(0.869608 0.018226 303.859)', 'line-2': 'oklch(0.834773 0.023405 303.676)', 'text': 'oklch(0.222003 0.03479 328.979)', 'muted': 'oklch(0.543042 0.018894 325.652)', 'accent': 'oklch(0.525348 0.15373 294.176)', 'accent-fg': 'oklch(0.990339 0.008411 325.64)', 'danger': 'oklch(0.637823 0.237287 25.436)' },
    dark: { 'bg': 'oklch(0.225975 0.031062 293.741)', 'panel': 'oklch(0.335291 0.026008 296.394)', 'panel-2': 'oklch(0.386739 0.024023 297.509)', 'hover': 'oklch(0.372436 0.07841 294.204)', 'pressed': 'oklch(0.325405 0.063614 294.23)', 'line': 'oklch(0.40874 0.058536 295.893)', 'line-2': 'oklch(0.46756 0.065775 296.265)', 'text': 'oklch(0.990339 0.008411 325.64)', 'muted': 'oklch(0.640465 0.016197 304.171)', 'accent': 'oklch(0.671712 0.169136 293.929)', 'accent-fg': 'oklch(0.222003 0.03479 328.979)', 'danger': 'oklch(0.655108 0.221148 23.473)' } },
  'claude-graphite': { label: "Claude · тёплый графит",
    dark: { 'bg': '#262624', 'panel': '#30302e', 'panel-2': '#30302e', 'hover': '#3a3a37', 'pressed': '#30302e', 'line': '#3b3a36', 'line-2': '#4a4944', 'text': '#faf9f5', 'muted': '#a6a39a', 'accent': '#d97757', 'accent-fg': '#ffffff', 'danger': '#e5534b' } },
  'volna-bakelite': { label: "Волна · бакелит и лампа",
    dark: { 'bg': '#2a2522', 'panel': '#38312c', 'panel-2': '#38312c', 'hover': '#3b342f', 'pressed': '#332d29', 'line': '#3a332e', 'line-2': '#4a423b', 'text': '#efe7d6', 'muted': '#b7aa93', 'accent': '#e8a33d', 'accent-fg': '#1f1b18', 'danger': '#b8321f' } },
  };
  const KEY = 'draftwall:theme';
  const media = matchMedia('(prefers-color-scheme: dark)');
  const read = () => { try { return { id: 'default', mode: 'system', ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { id: 'default', mode: 'system' }; } };
  let choice = read();
  if (!THEMES[choice.id]) choice.id = 'default';

  function appearance() {
    const t = THEMES[choice.id];
    if (!t.light) return 'dark';
    return choice.mode === 'system' ? (media.matches ? 'dark' : 'light') : choice.mode;
  }

  function apply() {
    const look = appearance(), vars = THEMES[choice.id][look], s = document.documentElement.style;
    for (const [k, v] of Object.entries(vars)) s.setProperty('--' + k, v);
    const dark = look === 'dark';
    s.setProperty('--faint', 'color-mix(in oklab, var(--muted) 62%, var(--bg))');
    s.setProperty('--dot', dark ? 'color-mix(in oklab, var(--text) 8%, transparent)' : 'color-mix(in oklab, var(--text) 11%, transparent)');
    s.setProperty('--board-edge', dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.08)');
    s.setProperty('--board-shadow', dark ? '0 10px 40px rgba(0,0,0,.55)' : '0 6px 28px rgba(0,0,0,.09)');
    s.setProperty('--chrome-shadow', dark ? '0 4px 16px rgba(0,0,0,.3)' : '0 4px 16px rgba(0,0,0,.08)');
    s.colorScheme = look;
    document.documentElement.dataset.look = look; // diagram boards pick their paper by it
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars.bg);
  }

  function save(next) {
    choice = { ...choice, ...next };
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch {}
    apply(); render();
  }

  media.addEventListener('change', () => { if (choice.mode === 'system') apply(); });
  addEventListener('storage', e => { if (e.key === KEY) { choice = read(); apply(); render(); } });
  apply();

  // ---- picker: a popover under the button passed to mountPicker ----
  const CSS = `
#theme-pop { position: fixed; z-index: 20; width: 290px; padding: 8px; background: var(--panel); color: var(--text);
  border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--chrome-shadow); font: 13px/1.4 var(--font, system-ui); }
#theme-pop[hidden] { display: none; }
#theme-pop .seg { display: flex; gap: 2px; padding: 2px; margin-bottom: 6px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; }
#theme-pop .seg button { flex: 1; height: 26px; border-radius: 6px; color: var(--muted); font-weight: 500; }
#theme-pop .seg button[aria-pressed="true"] { background: var(--panel); color: var(--text); box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,.12); }
#theme-pop .seg button:disabled { opacity: .45; cursor: default; }
#theme-pop ul { list-style: none; margin: 0; padding: 0; }
#theme-pop li button { display: flex; align-items: center; gap: 10px; width: 100%; height: 32px; padding: 0 8px; border-radius: 7px; color: var(--text); text-align: left; }
#theme-pop li button:hover { background: var(--hover); }
#theme-pop .sw { position: relative; flex: none; width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(127,127,127,.35); overflow: hidden; }
#theme-pop .sw i { position: absolute; right: 0; bottom: 0; width: 9px; height: 9px; border-radius: 50% 0 0 0; }
#theme-pop .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#theme-pop .tag { color: var(--faint); font-size: 11px; }
#theme-pop .check { width: 14px; height: 14px; color: var(--accent); visibility: hidden; }
#theme-pop li button[aria-checked="true"] .check { visibility: visible; }
#theme-pop button { font: inherit; background: none; border: 0; cursor: pointer; }`;
  const CHECK = '<svg class="check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>';
  let pop, anchor;

  function render() {
    if (!pop) return;
    const t = THEMES[choice.id], look = appearance();
    pop.querySelectorAll('.seg button').forEach(b => {
      b.disabled = !t.light;
      b.setAttribute('aria-pressed', String(t.light ? b.dataset.mode === choice.mode : b.dataset.mode === 'dark'));
    });
    const ul = pop.querySelector('ul'); ul.textContent = '';
    for (const [id, th] of Object.entries(THEMES)) {
      const v = th[th.light ? look : 'dark'];
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" role="menuitemradio" aria-checked="${id === choice.id}"><span class="sw" style="background:${v.bg}"><i style="background:${v.accent}"></i></span><span class="name"></span>${th.light ? '' : '<span class="tag">dark</span>'}${CHECK}</button>`;
      li.querySelector('.name').textContent = th.label;
      li.querySelector('button').addEventListener('click', () => save({ id }));
      ul.append(li);
    }
  }

  function place() {
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.top = r.bottom + 8 + 'px';
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  }

  function toggle(open = pop.hidden) {
    pop.hidden = !open; anchor.setAttribute('aria-expanded', String(open));
    if (open) { render(); place(); }
  }

  function mountPicker(button) {
    anchor = button;
    const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
    pop = document.createElement('div'); pop.id = 'theme-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Theme');
    pop.innerHTML = '<div class="seg" role="group" aria-label="Appearance"><button type="button" data-mode="system">Auto</button><button type="button" data-mode="light">Light</button><button type="button" data-mode="dark">Dark</button></div><ul role="menu"></ul>';
    pop.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => save({ mode: b.dataset.mode })));
    document.body.append(pop);
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    // Pointer events on the canvas may stop click propagation, so close on pointerdown outside.
    addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !button.contains(e.target)) toggle(false); }, true);
    addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { toggle(false); button.focus(); } });
    addEventListener('resize', () => { if (!pop.hidden) place(); });
  }

  window.draftwallTheme = { mountPicker, isOpen: () => !!pop && !pop.hidden };
})();

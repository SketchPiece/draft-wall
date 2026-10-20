// Draws the little potted plants used across the Sprout boards: <i data-plant="monstera" data-pot="#c8714b"></i>
(() => {
  const leaf = (x, y, len, w, ang, fill, vein = 'rgba(255,255,255,.35)', edge = '') =>
    `<g transform="translate(${x} ${y}) rotate(${ang})"><path d="M0 0C${w} ${-len * .25} ${w * .8} ${-len * .8} 0 ${-len}C${-w * .8} ${-len * .8} ${-w} ${-len * .25} 0 0Z" fill="${fill}"${edge ? ` stroke="${edge}" stroke-width="1.6"` : ''}/>` +
    `<path d="M0 -2L0 ${-len * .86}" stroke="${vein}" stroke-width="1.2" stroke-linecap="round"/></g>`;
  const stem = (x1, y1, x2, y2, c = '#3d6b3f') => `<path d="M${x1} ${y1}Q${(x1 + x2) / 2} ${y1 - 6} ${x2} ${y2}" stroke="${c}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  const pot = c => `<rect x="25" y="86" width="50" height="9" rx="2.5" fill="${c}"/><path d="M29 95H71L66.5 116.5Q66 119 63 119H37Q34 119 33.5 116.5Z" fill="${c}"/><path d="M29 95H71L70.4 98H29.6Z" fill="rgba(0,0,0,.14)"/><ellipse cx="50" cy="87" rx="22" ry="2.6" fill="#5b4031"/>`;
  const G = ['#2f6b45', '#3f8452', '#4f9a62', '#6bb37a', '#86c08e'];
  const PLANTS = {
    monstera: () => stem(50, 86, 30, 52) + stem(50, 86, 70, 50) + stem(50, 86, 50, 40) +
      leaf(30, 54, 34, 24, -48, G[1]) + leaf(70, 52, 36, 24, 46, G[0]) + leaf(50, 44, 38, 26, -4, G[2]) +
      leaf(44, 80, 26, 18, -78, G[3]) + leaf(58, 78, 24, 17, 74, G[1]),
    snake: () => [[-14, 58, G[0]], [-5, 74, G[1]], [5, 68, G[0]], [14, 54, G[2]], [0, 50, G[3]]]
      .map(([a, l, c], i) => leaf(44 + i * 3, 88, l, 8, a, c, 'rgba(255,255,255,.2)', '#d9c65f')).join(''),
    pothos: () => stem(50, 86, 20, 104, '#4f7d3d') + stem(50, 86, 82, 100, '#4f7d3d') +
      leaf(50, 84, 22, 15, -10, G[3]) + leaf(42, 84, 20, 14, -46, G[4]) + leaf(58, 84, 21, 14, 40, G[2]) +
      leaf(26, 96, 16, 11, -150, G[3]) + leaf(18, 106, 14, 10, -170, G[4]) + leaf(76, 94, 16, 11, 150, G[2]) + leaf(84, 104, 14, 10, 172, G[3]),
    fiddle: () => `<path d="M50 86V24" stroke="#6b4f3a" stroke-width="3" stroke-linecap="round"/>` +
      leaf(50, 70, 24, 18, -62, G[0]) + leaf(50, 60, 24, 18, 60, G[1]) + leaf(50, 48, 24, 18, -58, G[1]) +
      leaf(50, 38, 24, 18, 56, G[0]) + leaf(50, 28, 22, 17, -20, G[2]),
    fern: () => [-70, -52, -34, -16, 0, 16, 34, 52, 70].map((a, i) => leaf(50, 88, 40 - Math.abs(a) / 5, 7, a, G[i % 2 ? 3 : 2])).join(''),
    cactus: () => `<rect x="40" y="30" width="20" height="58" rx="10" fill="${G[2]}"/><path d="M41 62H32a7 7 0 0 1-7-7V46a4 4 0 0 1 8 0v8h8Z" fill="${G[3]}"/>` +
      `<path d="M59 54h8v-12a4 4 0 0 1 8 0v13a7 7 0 0 1-7 7h-9Z" fill="${G[1]}"/><path d="M50 34V84" stroke="rgba(255,255,255,.25)" stroke-width="1.5"/>` +
      `<circle cx="50" cy="28" r="4" fill="#ef8aa6"/>`,
  };
  for (const el of document.querySelectorAll('[data-plant]')) {
    const kind = el.dataset.plant, potColor = el.dataset.pot || '#c8714b';
    el.outerHTML = `<svg class="plant ${el.className}" viewBox="0 0 100 122" aria-hidden="true">${(PLANTS[kind] || PLANTS.monstera)()}${pot(potColor)}</svg>`;
  }
})();

// The tab bar: <nav class="tabs" data-on="today"></nav>
(() => {
  const I = {
    today: '<path d="M4 9.5 12 4l8 5.5V19a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1Z"/>',
    shelf: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    learn: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v14H6.5A1.5 1.5 0 0 0 5 19.5Z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
    me: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5"/>',
  };
  const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  for (const nav of document.querySelectorAll('nav.tabs')) {
    const on = nav.dataset.on;
    const tab = (k, label) => `<span class="${k === on ? 'on' : ''}">${svg(I[k])}${label}</span>`;
    nav.innerHTML = tab('today', 'Today') + tab('shelf', 'Shelf') +
      `<span><b class="add">${svg('<path d="M12 6v12M6 12h12"/>')}</b></span>` + tab('learn', 'Learn') + tab('me', 'Me');
  }
})();

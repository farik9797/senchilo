// Условный план подъездного пути: изолинии из шума (marching squares), ж/д в условных знаках,
// граница пути необщего пользования оранжевым. Рисуется на canvas, цвета берутся из токенов.
(() => {
  const root = getComputedStyle(document.documentElement);
  const tok = (n) => root.getPropertyValue(n).trim();

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(seed) {
    const r = rng(seed), N = 256, p = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) p[i] = r();
    const sm = (t) => t * t * (3 - 2 * t);
    const at = (x, y) => p[(y & 255) * N + (x & 255)];
    const v = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), u = sm(x - xi), w = sm(y - yi);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
    };
    return (x, y) => v(x, y) * 0.6 + v(x * 2.1 + 5.3, y * 2.1 + 1.7) * 0.28 + v(x * 4.3 + 9.1, y * 4.3 + 3.3) * 0.12;
  }

  // Изолинии: возвращает отрезки по уровням, чтобы потом подписать утолщённые.
  function contours(ctx, W, H, field, opts) {
    const { step, base, interval, count, color, heavyEvery, label } = opts;
    const cols = Math.ceil(W / step) + 1, rows = Math.ceil(H / step) + 1;
    const g = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) g[j * cols + i] = field(i * step, j * step);
    const lerp = (a, b, L) => (L - a) / (b - a);
    const labels = [];
    for (let k = 0; k < count; k++) {
      const L = base + k * interval, heavy = k % heavyEvery === 0;
      ctx.beginPath();
      let candidate = null;
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = g[j * cols + i], b = g[j * cols + i + 1], c = g[(j + 1) * cols + i + 1], d = g[(j + 1) * cols + i];
          const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          const x = i * step, y = j * step;
          const T = [x + step * lerp(a, b, L), y], R = [x + step, y + step * lerp(b, c, L)];
          const B = [x + step * lerp(d, c, L), y + step], Lf = [x, y + step * lerp(a, d, L)];
          const segs = {
            1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[T, R]], 5: [[Lf, T], [B, R]], 6: [[T, B]], 7: [[Lf, T]],
            8: [[Lf, T]], 9: [[T, B]], 10: [[T, R], [Lf, B]], 11: [[T, R]], 12: [[Lf, R]], 13: [[B, R]], 14: [[Lf, B]],
          }[idx];
          for (const [p, q] of segs) {
            ctx.moveTo(p[0], p[1]);
            ctx.lineTo(q[0], q[1]);
            if (heavy && label && !candidate) {
              const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
              const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
              if (label.region(mx, my) && Math.abs(Math.sin(ang)) < 0.35) candidate = { x: mx, y: my, ang, L };
            }
          }
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = heavy ? 1.3 : 0.7;
      ctx.globalAlpha = heavy ? 0.9 : 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (candidate) labels.push(candidate);
    }
    return labels;
  }

  const cubic = (P, t) => {
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]);
  };
  const pathOf = (P) => {
    const p = new Path2D();
    p.moveTo(...P[0]);
    p.bezierCurveTo(...P[1], ...P[2], ...P[3]);
    return p;
  };

  // Условный знак железной дороги: двойная линия с чередующимися чёрными и белыми отрезками.
  function rail(ctx, path, w, dash, ink, paper) {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = ink; ctx.lineWidth = w; ctx.setLineDash([]); ctx.stroke(path);
    ctx.strokeStyle = paper; ctx.lineWidth = w - 2; ctx.stroke(path);
    ctx.strokeStyle = ink; ctx.lineWidth = w - 2; ctx.setLineDash([dash, dash]); ctx.stroke(path);
    ctx.setLineDash([]);
  }

  function tag(ctx, x, y, text, open, c) {
    ctx.font = '500 13px Onest, system-ui, sans-serif';
    const w = ctx.measureText(text).width + 16, h = 24;
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2, w, h, 4);
    ctx.fillStyle = open ? c.ink : c.paper2;
    ctx.fill();
    if (!open) { ctx.strokeStyle = c.rule; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = open ? c.paper2 : c.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8, y + 0.5);
  }

  function pin(ctx, x, y, shape, fill, ring) {
    ctx.beginPath();
    if (shape === 'disc') ctx.arc(x, y, 7, 0, Math.PI * 2);
    if (shape === 'diamond') { ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 8); ctx.lineTo(x - 8, y); ctx.closePath(); }
    if (shape === 'triangle') { ctx.moveTo(x, y - 8); ctx.lineTo(x + 8, y + 6); ctx.lineTo(x - 8, y + 6); ctx.closePath(); }
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke();
  }

  function setup(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, W: r.width, H: r.height };
  }

  function drawPlan(canvas) {
    const { ctx, W, H } = setup(canvas);
    const c = {
      paper: tok('--color-paper'), paper2: tok('--color-paper-2'), ink: tok('--color-ink'), muted: tok('--color-muted'),
      rule: tok('--color-rule'), contour: tok('--color-contour'), water: tok('--color-water'), hedge: tok('--color-hedge'),
      accent: tok('--color-accent'), accentSoft: tok('--color-accent-soft'),
    };
    ctx.fillStyle = c.paper; ctx.fillRect(0, 0, W, H);

    // зерно бумаги и два сгиба
    const r = rng(7);
    ctx.fillStyle = c.ink;
    for (let i = 0; i < (W * H) / 90; i++) { ctx.globalAlpha = 0.03 + r() * 0.03; ctx.fillRect(r() * W, r() * H, 1, 1); }
    ctx.globalAlpha = 1;
    [[W * 0.5, 0, W * 0.5 + 14, 0, 'x'], [0, H * 0.52, 0, H * 0.52 + 14, 'y']].forEach(([x0, y0, x1, y1, ax]) => {
      const gr = ctx.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, c.ink); gr.addColorStop(1, c.paper);
      ctx.globalAlpha = 0.05; ctx.fillStyle = gr;
      ax === 'x' ? ctx.fillRect(x0, 0, 14, H) : ctx.fillRect(0, y0, W, 14);
      ctx.globalAlpha = 1;
    });

    // рельеф
    const n = makeNoise(20111);
    const scale = 1 / 260;
    const field = (x, y) => 200 + 48 * n(x * scale + 3.1, y * scale + 1.4);
    const labels = contours(ctx, W, H, field, {
      step: 8, base: 206, interval: 1, count: 34, color: c.contour, heavyEvery: 5,
      label: { region: (x, y) => x > W * 0.12 && x < W * 0.96 && y > H * 0.06 && y < H * 0.94 },
    });
    ctx.font = '400 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    labels.slice(0, 7).forEach(({ x, y, ang, L }) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      const t = String(Math.round(L)), w = ctx.measureText(t).width + 6;
      ctx.fillStyle = c.paper; ctx.fillRect(-w / 2, -7, w, 14);
      ctx.fillStyle = c.contour; ctx.fillText(t, -w / 2 + 3, 0.5);
      ctx.restore();
    });

    // ручей
    const brook = pathOf([[-0.02 * W, 0.86 * H], [0.3 * W, 0.76 * H], [0.55 * W, 1.02 * H], [1.02 * W, 0.86 * H]]);
    ctx.strokeStyle = c.water; ctx.lineWidth = 2.5; ctx.stroke(brook);
    ctx.globalAlpha = 0.35; ctx.lineWidth = 7; ctx.stroke(brook); ctx.globalAlpha = 1;

    // лесополосы
    ctx.fillStyle = c.hedge;
    [[[0.04 * W, 0.16 * H], [0.16 * W, 0.3 * H], [0.32 * W, 0.18 * H], [0.46 * W, 0.26 * H]],
     [[0.7 * W, 0.5 * H], [0.68 * W, 0.62 * H], [0.74 * W, 0.7 * H], [0.98 * W, 0.72 * H]]].forEach((P) => {
      for (let t = 0; t <= 1; t += 0.006) { const [x, y] = cubic(P, t); ctx.beginPath(); ctx.arc(x, y, 1.3, 0, Math.PI * 2); ctx.fill(); }
    });

    // главный путь станции и подъездной путь
    const main = [[0.28 * W, 0.02 * H], [0.5 * W, 0.16 * H], [0.78 * W, 0.12 * H], [1.04 * W, 0.06 * H]];
    const S = cubic(main, 0.3);
    const end = [0.88 * W, 0.31 * H];
    const siding = [S, [0.58 * W, 0.16 * H], [0.74 * W, 0.3 * H], end];

    // граница пути необщего пользования: от стрелки, ниже главного пути
    const hull = [[0.5, 0.135], [0.62, 0.2], [0.8, 0.18], [0.98, 0.16], [0.98, 0.42], [0.8, 0.44], [0.64, 0.38], [0.53, 0.2]].map(([x, y]) => [x * W, y * H]);
    const edge = new Path2D();
    hull.forEach(([x, y], i) => (i ? edge.lineTo(x, y) : edge.moveTo(x, y)));
    edge.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = c.accentSoft; ctx.lineWidth = 10; ctx.stroke(edge);
    ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.stroke(edge);

    // проезд к предприятию
    const lane = [[0.67 * W, -0.02 * H], [0.66 * W, 0.2 * H], [0.6 * W, 0.6 * H], [0.62 * W, 1.02 * H]];
    const laneP = pathOf(lane);
    ctx.strokeStyle = c.ink; ctx.lineWidth = 8; ctx.stroke(laneP);
    ctx.strokeStyle = c.paper; ctx.lineWidth = 6; ctx.stroke(laneP);

    // здания с штриховкой
    [[0.8, 0.245, 96, 40, 0.06], [0.93, 0.25, 60, 64, 0], [0.7, 0.35, 48, 28, 0.1]].forEach(([x, y, w, h, a]) => {
      ctx.save(); ctx.translate(x * W, y * H); ctx.rotate(a);
      ctx.fillStyle = c.paper2; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.save(); ctx.clip();
      ctx.strokeStyle = c.ink; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.6;
      for (let k = -h; k < w + h; k += 6) { ctx.beginPath(); ctx.moveTo(-w / 2 + k, -h / 2); ctx.lineTo(-w / 2 + k - h, h / 2); ctx.stroke(); }
      ctx.restore(); ctx.globalAlpha = 1;
      ctx.strokeStyle = c.ink; ctx.lineWidth = 1.2; ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    });

    rail(ctx, pathOf(main), 7, 14, c.ink, c.paper);
    rail(ctx, pathOf(siding), 5, 9, c.ink, c.paper);
    // тупиковый упор
    ctx.strokeStyle = c.ink; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(end[0] + 2, end[1] - 8); ctx.lineTo(end[0] + 2, end[1] + 8); ctx.stroke();

    const X = cubic(siding, 0.5);
    pin(ctx, S[0], S[1], 'disc', c.ink, c.paper2);
    pin(ctx, X[0], X[1], 'diamond', c.ink, c.paper2);
    pin(ctx, end[0] + 22, end[1], 'triangle', c.accent, c.ink);
    // на узком экране подписи уходят под заголовок, остаются только знаки
    if (W >= 900) tag(ctx, S[0] - 182, S[1] - 18, 'Стрелочный перевод № 1', false, c);
    tag(ctx, X[0] + 16, X[1] - 18, 'Переезд', false, c);
    tag(ctx, end[0] + 36, end[1], 'Упор', true, c);

    ctx.font = '400 11px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = c.muted;
    ctx.textBaseline = 'alphabetic';
    const note = 'Условный план, пример';
    ctx.fillText(note, W - ctx.measureText(note).width - 16, H - 14);
  }

  function drawBand(canvas) {
    const { ctx, W, H } = setup(canvas);
    ctx.clearRect(0, 0, W, H);
    const n = makeNoise(1504);
    const field = (x, y) => 100 * n(x / 300 + 7.7, y / 300 + 2.2);
    ctx.globalAlpha = 1;
    contours(ctx, W, H, field, { step: 8, base: 30, interval: 2.2, count: 20, color: tok('--color-ink'), heavyEvery: 5 });
    canvas.style.opacity = '0.16';
  }

  const plan = document.querySelector('[data-map="plan"]');
  const band = document.querySelector('[data-map="band"]');
  const draw = () => { if (plan) drawPlan(plan); if (band) drawBand(band); };
  let t;
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(draw);
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 150); });
})();

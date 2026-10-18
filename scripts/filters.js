/* ============================================================
   filters.js — the "film lab"
   RAW-ish sensor data -> digicam / c-drama pipeline on canvas:
     auto white balance -> tone curve -> saturation ->
     chroma noise (CCD) -> luma noise (grain) ->
     JPEG-ish color bleed -> bloom/halation or star bursts ->
     timestamp burn-in
   Each filter is a "film recipe" described with plain numbers.
   ============================================================ */

export const TIMESTAMP_DEFAULT = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* Clamp into 0..255 fast */
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/* Deterministic-ish gaussian noise generator (recycled buffers) */
let noiseCanvas = null;
function makeNoiseTile(size = 128) {
  if (noiseCanvas) return noiseCanvas;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseCanvas = c;
  return c;
}

function makeStarTile(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;
  ctx.translate(r, r);
  for (let a = 0; a < 6; a++) {
    ctx.rotate(Math.PI / 3);
    // vary ray length a bit, like lens coatings do
    const len = r * (0.72 + 0.25 * Math.random());
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 11);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/* ---------- filter definitions (film recipes) ---------- */

export const FILTERS = [
  {
    id: 'youth',
    name: '青春剧',
    en: 'C-Drama Youth',
    desc: '透亮的粉橘色回忆，轻柔光晕',
    params: {
      brightness: 6, contrast: 4, saturation: 6, tealOrange: 8,
      warmth: 9, coolness: 3, fade: 10,
      filmGrain: 22, colorGrain: 14,
      colorBleed: 9, halation: 14,
      vignette: 4, starburst: 4,
      timestamp: false,
    },
  },
  {
    id: 'idphoto',
    name: '证件 selfie',
    en: 'Candid Digicam 2006',
    desc: '老校服相册的阳光感',
    params: {
      brightness: -6, contrast: 12, saturation: -8, tealOrange: 0,
      warmth: 0, coolness: 0, fade: 0,
      filmGrain: 34, colorGrain: 22,
      colorBleed: 4, halation: 0,
      vignette: 16, starburst: 0,
      timestamp: '2006-05-20 16:03',
    },
  },
  {
    id: 'cctv',
    name: '旧监控',
    en: 'CCTV Grain',
    desc: '走廊尽头的那台旧机器',
    params: {
      brightness: -8, contrast: 14, saturation: -24, tealOrange: -12,
      warmth: -6, coolness: 7, fade: 4,
      filmGrain: 46, colorGrain: 32,
      colorBleed: 13, halation: 0,
      vignette: 24, starburst: 0,
      scanlines: true, timestamp: '2024-11-01 23:10',
    },
  },
  {
    id: 'digicam',
    name: '巨头闪光灯',
    en: 'Flash candid',
    desc: '被闪光灯照亮的教室黄昏',
    params: {
      brightness: 14, contrast: 11, saturation: 8, tealOrange: 0,
      warmth: 6, coolness: 0, fade: 2,
      filmGrain: 30, colorGrain: 20,
      colorBleed: 6, halation: 20,
      vignette: 10, starburst: 10,
      timestamp: '2009-06-01 23:10',
    },
  },
  {
    id: 'emptyband',
    name: '清爽橘',
    en: 'Cheerful citrus',
    desc: '运动会与汽水味的下午',
    params: {
      brightness: 10, contrast: 7, saturation: 10, tealOrange: 6,
      warmth: 12, coolness: 0, fade: 6,
      filmGrain: 26, colorGrain: 16,
      colorBleed: 7, halation: 12,
      vignette: 6, starburst: 0,
      timestamp: false,
    },
  },
];

export const FILTER_INTENSITY_DEFAULT = 100;

/**
 * Apply a filter to a source image onto a canvas at output resolution.
 * @param {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement} source
 * @param {object} opts
 * @param {object}  opts.filterEntry   FILTERS[ i ]
 * @param {number}  opts.intensity     0..200
 * @param {number}  opts.width, opts.height  output size
 * @param {boolean} opts.mirror        mirror horizontally
 * @param {{onClickShoot:number[]}} opts.starPoints  normalized (0..1) star centers
 * @param {string|false} opts.timestampOverride
 * @returns {HTMLCanvasElement}
 */
export function applyFilterToCanvas(source, opts) {
  const { intensity = 100, mirror = false, starPoints = [] } = opts;
  const W = opts.width, H = opts.height;
  const src = source;

  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true });

  if (mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  // cover-fit crop
  const srcW = src.videoWidth || src.naturalWidth || src.width;
  const srcH = src.videoHeight || src.naturalHeight || src.height;
  const scale = Math.max(W / srcW, H / srcH);
  const dw = srcW * scale, dh = srcH * scale;
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const k = intensity / 100;
  const pr = opts.filterEntry.params;

  /* 1. auto white balance (gray-world) + manual tint ------------------ */
  autoWhiteBalance(ctx, W, H, 0.35);
  if (pr.warmth || pr.coolness) {
    tint(ctx, W, H, (pr.warmth * k) / 100, (pr.coolness * k) / 100);
  }

  /* 2. tone curve: brightness / contrast / fade ---------------------- */
  toneCurve(ctx, W, H, pr.brightness * k, pr.contrast, pr.fade * k);

  /* 3. saturation + teal-orange grade -------------------------------- */
  saturate(ctx, W, H, pr.saturation * k, pr.tealOrange * k);

  /* 4. luminance noise (film grain) ---------------------------------- */
  if (pr.filmGrain) addLumaNoise(ctx, W, H, (pr.filmGrain * k) / 100);

  /* 5. chroma noise (CCD color speckle) ------------------------------ */
  if (pr.colorGrain) addChromaNoise(ctx, W, H, (pr.colorGrain * k) / 100);

  /* 6. JPEG-ish color bleed ------------------------------------------ */
  if (pr.colorBleed) colorBleed(ctx, W, H, (pr.colorBleed * k) / 100);

  /* 7. halation bloom ------------------------------------------------ */
  if (pr.halation) halation(out, ctx, (pr.halation * k) / 100);

  /* 8. star bursts --------------------------------------------------- */
  let stars = [];
  if (pr.starburst && starPoints.length) {
    stars = starPoints.map(([nx, ny]) => [nx * W, ny * H]);
  }
  if (pr.starburst) {
    starburst(out, ctx, (pr.starburst * k) / 100, stars);
  }

  /* 9. vignette ------------------------------------------------------ */
  if (pr.vignette) vignette(ctx, W, H, (pr.vignette * k) / 100);

  /* 10. scanlines (CCTV) --------------------------------------------- */
  if (pr.scanlines) scanlines(ctx, W, H);

  /* 11. timestamp burn-in -------------------------------------------- */
  const ts = opts.timestampOverride !== undefined
    ? opts.timestampOverride
    : pr.timestamp;
  if (ts) drawTimestamp(ctx, W, H, ts);

  return out;
}

/* ------------------- individual steps ------------------- */

function getImageData(ctx, W, H) {
  return ctx.getImageData(0, 0, W, H);
}

function autoWhiteBalance(ctx, W, H, strength = 0.5) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for (let i = 0; i < d.length; i += 40) {
    rSum += d[i]; gSum += d[i + 1]; bSum += d[i + 2]; n++;
  }
  if (!n) return;
  const rAvg = rSum / n, gAvg = gSum / n, bAvg = bSum / n;
  const gAvg2 = (rAvg + gAvg + bAvg) / 3;
  const rGain = 1 + strength * ((gAvg2 - rAvg) / 255);
  const gGain = 1, bGain = 1 + strength * ((gAvg2 - bAvg) / 255);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = cl(d[i] * rGain);
    d[i + 2] = cl(d[i + 2] * bGain);
  }
  ctx.putImageData(img, 0, 0);
}

function tint(ctx, W, H, warmth = 0, coolness = 0) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const wA = warmth * 10, wB = -warmth * 7, cB = coolness * 9, cR = -coolness * 6;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = cl(d[i] + wA + cR);
    d[i + 2] = cl(d[i + 2] + wB + cB);
  }
  ctx.putImageData(img, 0, 0);
}

function toneCurve(ctx, W, H, brightness = 0, contrast = 0, fade = 0) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const c = 1 + contrast / 100;
  const fadeFloor = fade * 1.4;   // lifts the blacks for that "washed" look
  for (let i = 0; i < d.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let v = d[i + ch];
      v = (v - 128) * c + 128 + brightness;
      if (fadeFloor) v = fadeFloor + v * (1 - fadeFloor / 208);
      d[i + ch] = cl(v);
    }
  }
  ctx.putImageData(img, 0, 0);
}

function saturate(ctx, W, H, satDelta = 0, tealOrange = 0) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const s = 1 + satDelta / 60;
  const tA = tealOrange / 100;   // teal shadows / orange highlights
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * s;
    g = l + (g - l) * s;
    b = l + (b - l) * s;
    if (tA) {
      if (l < 128) { // shadows -> teal
        const tC = tA * (1 - l / 128) * 36;
        g += tC * 0.5; b += tC;
      } else {       // highlights -> warm orange
        const tC = tA * (l / 128 - 1) * 30;
        r += tC; g += tC * 0.42;
      }
    }
    d[i] = cl(r); d[i + 1] = cl(g); d[i + 2] = cl(b);
  }
  ctx.putImageData(img, 0, 0);
}

function addLumaNoise(ctx, W, H, amount = 0.3) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const amp = amount * 42;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() * 2 - 1) * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function addChromaNoise(ctx, W, H, amount = 0.3) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const amp = amount * 26;
  for (let i = 0; i < d.length; i += 4) {
    d[i] += (Math.random() * 2 - 1) * amp;
    d[i + 1] += (Math.random() * 2 - 1) * amp * 0.6;
    d[i + 2] += (Math.random() * 2 - 1) * amp;
  }
  ctx.putImageData(img, 0, 0);
}

function colorBleed(ctx, W, H, amount = 0.3) {
  // poor-man's JPEG chroma subsample: blur chroma (Cb/Cr) only
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const y = new Float32Array(W * H);
  const cb = new Float32Array(W * H);
  const cr = new Float32Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    y[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    cb[p] = b - y[p];
    cr[p] = r - y[p];
  }
  const m = (p) => p;
  const w = Math.max(1, Math.round(amount * 2.4));
  const tmpC = new Float32Array(W * H);
  // horizontal box blur on chroma
  for (let yp = 0; yp < H; yp++) {
    for (let xp = 0; xp < W; xp++) {
      let ac = 0, ar = 0, cnt = 0;
      for (let t = -w; t <= w; t++) {
        const xq = xp + t;
        if (xq >= 0 && xq < W) { const p = m(yp * W + xq); ac += cb[p]; ar += cr[p]; cnt++; }
      }
      const p2 = yp * W + xp;
      tmpC[p2 * 2] = ac / cnt;
      tmpC[p2 * 2 + 1] = ar / cnt;
    }
  }
  // vertical pass
  for (let yp = 0; yp < H; yp++) {
    for (let xp = 0; xp < W; xp++) {
      let ac = 0, ar = 0, cnt = 0;
      for (let t = -w; t <= w; t++) {
        const yq = yp + t;
        if (yq >= 0 && yq < H) { const p = m(yq * W + xp); ac += tmpC[p * 2]; ar += tmpC[p * 2 + 1]; cnt++; }
      }
      const p2 = yp * W + xp;
      cb[p2] = ac / cnt;
      cr[p2] = ar / cnt;
    }
  }
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    // keep luma detail sharp, bleed only chroma — very "early JPEG"
    const l = y[p];
    d[i] = cl(l + cr[p]);
    d[i + 1] = cl(l - 0.344136 * cb[p] - 0.714136 * cr[p] + l * 0.05);
    d[i + 2] = cl(l + cb[p]);
  }
  ctx.putImageData(img, 0, 0);
}

function stackCanvas(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}

function halation(canvas, ctx, amount = 0.5) {
  const W = canvas.width, H = canvas.height;
  const small = stackCanvas(Math.max(2, W >> 3), Math.max(2, H >> 3));
  const sctx = small.getContext('2d');
  sctx.drawImage(canvas, 0, 0, small.width, small.height);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = Math.min(0.75, amount * 0.65);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, W, H);
  ctx.restore();
}

function starburst(canvas, ctx, amount = 0.6, starPoints = []) {
  const W = canvas.width, H = canvas.height;
  const tile = makeStarTile();

  // 1) auto-detected sparkle points: bright pixels sampled sparsely
  const pts = [...starPoints];
  if (!pts.length) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4 * 61) {
      const b = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (b > 235 && Math.random() < 0.22) {
        pts.push([i / 4 % W, Math.floor((i / 4) / W)]);
      }
    }
    // never explode on bright frames (sky, white walls…)
    if (pts.length > 40) {
      const stride = Math.ceil(pts.length / 40);
      const kept = [];
      for (let i = 0; i < pts.length; i += stride) kept.push(pts[i]);
      pts.length = 0;
      pts.push(...kept);
    }
  }

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const aAlpha = Math.min(0.85, 0.28 + amount * 0.5);
  for (const [px, py] of pts) {
    const s = (16 + 26 * amount) * (0.75 + Math.random() * 0.5);
    ctx.globalAlpha = aAlpha * (0.65 + Math.random() * 0.35);
    ctx.drawImage(tile, px - s, py - s, s * 2, s * 2);
  }
  ctx.restore();
}

function vignette(ctx, W, H, amount = 0.2) {
  ctx.save();
  const rIn = Math.min(W, H) * 0.42;
  const rOut = Math.max(W, H) * 0.78;
  const g = ctx.createRadialGradient(W / 2, H / 2, rIn, W / 2, H / 2, rOut);
  g.addColorStop(0, 'rgba(10,6,16,0)');
  g.addColorStop(1, `rgba(10,6,16,${Math.min(0.65, amount * 1.1)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function scanlines(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

function drawTimestamp(ctx, W, H, text) {
  const size = Math.max(15, Math.round(Math.min(W, H) * 0.052));
  ctx.save();
  ctx.font = `bold ${size}px "Courier New", Courier, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const x = W - Math.round(size * 0.5);
  const y = H - Math.round(size * 0.55);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = Math.round(size * 0.12);
  ctx.shadowOffsetY = Math.max(1, size * 0.06);
  ctx.fillStyle = 'rgba(255,196,100,0.92)';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* ============================================================
   app.js — 那些年 · 拍立得小站
   camera -> filters (RAW->JPEG-ish CCD pipeline) -> polaroid album
   ============================================================ */

import { FILTERS, applyFilterToCanvas, TIMESTAMP_DEFAULT } from './filters.js';
import * as store from './storage.js';
import { playShutter, playTimerTick, playSaved, setMuted, muted } from './audio.js';

/* -------------- state -------------- */
const state = {
  stream: null,
  videoTrack: null,
  facing: 'user',
  flash: true,
  countdownSec: 3,
  timestampMode: 'auto',
  aspect: '4:3',
  intensity: 100,
  filterIdx: 0,
  busy: false,
  photos: [],
  activeCollection: 'all',
  pendingPhoto: null,
};

/* -------------- dom shortcuts -------------- */
const $ = (id) => document.getElementById(id);
const video = $('camera-feed');
const modeSwitcher = $('viewfinder-mode-switcher');
const galleryScreen = $('gallery-screen');
const aboutScreen = $('about-screen');
const viewfinderScreen = $('viewfinder-screen');
const shutterBtn = $('shutter-button');
const toastBox = $('toast-container');

/* ============================================================
   camera
   ============================================================ */

async function openCamera(facing = state.facing) {
  try {
    $('camera-loading-overlay').classList.remove('hidden');
    $('camera-error-overlay').classList.add('hidden');
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing,
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
      audio: false,
    });

    state.stream = stream;
    state.videoTrack = stream.getVideoTracks()[0] || null;
    video.srcObject = stream;
    await video.play();
    state.facing = facing;
    $('camera-loading-overlay').classList.add('hidden');
    updateSwitcherVisibility();
  } catch (err) {
    console.error('camera error', err);
    $('camera-loading-overlay').classList.add('hidden');
    const errBox = $('camera-error-overlay');
    const msg = {
      NotAllowedError: '嗯…你没有给它摄像头权限。可以在浏览器地址栏重新允许，或者点下面再试一次。',
      NotFoundError: '好像找不到摄像头设备？换个设备试试看吧。',
      NotReadableError: '摄像头被其他程序占用啦，关掉再回来试试。',
    }[err.name] || '出现了一点问题，请检查摄像头再试试看。';
    $('camera-error-message').textContent = msg;
    errBox.classList.remove('hidden');
  }
}

function updateSwitcherVisibility() {
  // hide flip button on desktops that only expose one camera
  navigator.mediaDevices?.enumerateDevices?.().then((devs) => {
    const cams = devs.filter((d) => d.kind === 'videoinput');
    $('camera-switcher').classList.toggle('hidden', cams.length < 2);
  });
}

/* ============================================================
   capture pipeline
   ============================================================ */

function computeOutputSize() {
  // pick source dimensions scaled toward ~1400px on the long edge
  const srcW = video.videoWidth || 1600;
  const srcH = video.videoHeight || 1200;
  const ratio = { '4:3': 4 / 3, '16:9': 16 / 9, '1:1': 1, '3:4': 3 / 4 }[state.aspect];
  let W, H;
  if (srcW / srcH > ratio) { H = Math.min(srcH, 1400); W = Math.round(H * ratio); }
  else { W = Math.min(srcW, 1600); H = Math.round(W / ratio); }
  W -= W % 2; H -= H % 2;
  return { W, H };
}

function torchAvailable() {
  return !!state.videoTrack?.getCapabilities?.()?.torch;
}

async function torch(on) {
  const track = state.videoTrack;
  if (!track) return false;
  const caps = track.getCapabilities?.();
  if (!caps || !caps.torch) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    return true;
  } catch { return false; }
}

function flashOverlay() {
  const fx = $('flash-effect-overlay');
  fx.classList.remove('fire');
  void fx.offsetWidth;
  fx.classList.add('fire');
}

function preflashOverlay() {
  const fx = $('pre-flash-effect-overlay');
  fx.classList.remove('fire');
  void fx.offsetWidth;
  fx.classList.add('fire');
}

function collectFlashPoints(W, H) {
  // sample a downscaled frame to find hugely bright spots (lights, sun, mirrors)
  const small = document.createElement('canvas');
  const sw = 160, sh = 120;
  small.width = sw; small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(video, 0, 0, sw, sh);
  const d = sctx.getImageData(0, 0, sw, sh).data;
  const pts = [];
  for (let i = 0; i < d.length; i += 4) {
    const b = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (b > 242) pts.push([((i / 4) % sw) / sw, Math.floor((i / 4) / sw) / sh]);
  }
  const pick = [];
  for (let i = 0; i < pts.length && pick.length < 8; i += Math.max(1, Math.floor(pts.length / 8) + 1)) pick.push(pts[i]);
  return pick;
}

async function countdownTick(seconds) {
  const ov = $('countdown-display-overlay');
  const val = $('countdown-value');
  ov.classList.remove('hidden');
  for (let s = seconds; s > 0; s--) {
    val.textContent = s;
    playTimerTick(false);
    await new Promise((r) => setTimeout(r, 980));
  }
  ov.classList.add('hidden');
  playTimerTick(true);
}

async function doCapture() {
  if (state.busy || !state.stream) { if (!state.stream) toast('先把摄像头打开吧 ♥'); return; }
  state.busy = true;
  shutterBtn.classList.add('cooling');

  try {
    // 1) optional countdown
    if (state.countdownSec > 0) await countdownTick(state.countdownSec);

    // 2) preflash + torch & preview overlay
    const hadTorch = await torch(true);
    preflashOverlay();
    await new Promise((r) => setTimeout(r, hadTorch ? 260 : 160));
    await torch(false);

    // 3) main flash + shutter sound
    if (state.flash) flashOverlay();
    playShutter();

    // 4) grab frame
    const src = video;
    if (!src.videoWidth || !src.videoHeight) {
      toast('摄像头还没准备好，稍等一秒再按一次吧');
      return;
    }
    const fEntry = FILTERS[state.filterIdx];
    const { W, H } = computeOutputSize();
    const raw = document.createElement('canvas');
    raw.width = W; raw.height = H;
    const rctx = raw.getContext('2d');
    rctx.translate(W, 0); rctx.scale(-1, 1);
    const scale = Math.max(W / src.videoWidth, H / src.videoHeight);
    const dw = src.videoWidth * scale, dh = src.videoHeight * scale;
    rctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);

    // 5) film lab
    const out = applyFilterToCanvas(raw, {
      filterEntry: fEntry,
      intensity: state.intensity,
      width: W, height: H,
      mirror: false, // already mirrored at grab time
      starPoints: state.flash ? collectFlashPoints(W, H) : [],
      timestampOverride: computeStamp(fEntry.params),
    });

    showCapturedPreview(out, fEntry);
  } catch (err) {
    console.error(err);
    toast('哎呀，出了点技术问题… 🥲');
  } finally {
    state.busy = false;
    shutterBtn.classList.remove('cooling');
  }
}

function showCapturedPreview(canvas, fEntry) {
  state.pendingPhoto = canvas;
  const ov = $('captured-photo-preview-overlay');
  const img = $('captured-photo-img');
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    img.src = url;
    img.dataset.blobUrl = url;
    state.pendingBlob = blob;
    ov.classList.remove('hidden');
  }, 'image/jpeg', 0.93);
}

/* save / discard handlers */
$('save-photo-btn').addEventListener('click', async () => {
  if (!state.pendingBlob) return;
  const fEntry = FILTERS[state.filterIdx];
  try {
    await store.savePhoto(state.pendingBlob, {
      filter: fEntry.id,
      filterName: fEntry.name,
      intensity: state.intensity,
      ts: Date.now(),
      aspect: state.aspect,
    });
    playSaved();
    toast('藏进相册啦 ♥');
  } catch (e) {
    console.error('save fail', e);
    toast('相册似乎满了？删一些照片再来试试。');
  }
  closeCapturePreview();
});

$('discard-photo-btn').addEventListener('click', closeCapturePreview);

function closeCapturePreview() {
  $('captured-photo-preview-overlay').classList.add('hidden');
  const img = $('captured-photo-img');
  if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
  img.src = '';
  state.pendingPhoto = null;
  state.pendingBlob = null;
}

/* ============================================================
   gallery
   ============================================================ */

async function refreshGallery() {
  try {
    state.photos = (await store.listPhotos()).sort((a, b) => b.meta.ts - a.meta.ts);
  } catch (e) {
    state.photos = [];
  }
  renderGallery();
}

function renderGallery() {
  const grid = $('gallery-grid');
  const empty = $('gallery-empty-state');
  const nav = $('gallery-navigation');
  grid.innerHTML = '';
  const all = state.photos;

  // collections: all / by filter
  const byFilter = {};
  for (const p of all) (byFilter[p.meta.filter] ||= []).push(p);
  const collections = [
    { id: 'all', label: `全部 (${all.length})` },
    ...FILTERS.map((f) => ({ id: f.id, label: `${f.name}` })),
  ].map((c) => ({ ...c, count: c.id === 'all' ? all.length : (byFilter[c.id] || []).length }));

  nav.innerHTML = '';
  for (const c of collections) {
    const b = document.createElement('button');
    b.className = 'collection-btn' + (state.activeCollection === c.id ? ' active' : '');
    b.textContent = c.label;
    b.onclick = () => { state.activeCollection = c.id; renderGallery(); };
    nav.appendChild(b);
  }

  const list = state.activeCollection === 'all'
    ? all
    : byFilter[state.activeCollection] || [];

  empty.classList.toggle('hidden', list.length > 0);

  for (const [idx, p] of list.entries()) {
    const url = URL.createObjectURL(p.blob);
    const card = document.createElement('div');
    card.className = 'photo-card';
    card.style.setProperty('--tilt', `${(((idx * 37) % 7) - 3) * 0.8}deg`);

    const img = new Image();
    img.src = url;
    img.loading = 'lazy';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const d = new Date(p.meta.ts);
    const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    meta.innerHTML = `<span>♥ ${p.meta.filterName}</span><span style="display:flex;align-items:center;gap:6px"><span>${dateStr}</span><button class="delete-btn" title="删除">×</span></span>`;

    card.appendChild(img);
    card.appendChild(meta);

    img.onload = () => URL.revokeObjectURL(url);

    card.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) return;
      openLightbox(p);
    });
    meta.querySelector('.delete-btn').addEventListener('click', async () => {
      await store.deletePhoto(p.id);
      refreshGallery();
      toast('删掉啦');
    });

    grid.appendChild(card);
  }
}

/* lightbox */
function openLightbox(photo) {
  const ov = $('lightbox-overlay');
  store.blobToDataURL(photo.blob).then((url) => {
    $('lightbox-img').src = url;
    const dl = $('lightbox-download-btn');
    dl.href = url;
    const d = new Date(photo.meta.ts);
    const p = (n) => String(n).padStart(2, '0');
    dl.download = `naxiesian_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.jpg`;
  });
  ov.classList.remove('hidden');
}
$('lightbox-close-btn').addEventListener('click', () => $('lightbox-overlay').classList.add('hidden'));
$('lightbox-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox-overlay') $('lightbox-overlay').classList.add('hidden');
});

/* ============================================================
   filter strip (top-left of viewfinder, floating chips)
   ============================================================ */

function buildFilterStrip() {
  const holder = document.createElement('div');
  holder.id = 'filter-strip';
  holder.style.cssText = 'position:absolute;left:12px;top:12px;z-index:5;display:flex;flex-direction:column;gap:8px;';
  for (const [i, f] of FILTERS.entries()) {
    const b = document.createElement('button');
    b.className = 'filter-chip' + (i === 0 ? ' active' : '');
    b.innerHTML = `<span class="zh">${f.name}</span><span class="en">${f.en}</span>`;
    b.onclick = () => selectFilter(i);
    holder.appendChild(b);
  }
  const intensity = document.createElement('div');
  intensity.className = 'intensity-slider';
  intensity.innerHTML = `<label>强度</label><input type="range" min="0" max="200" value="100" id="intensity-range">`;
  holder.appendChild(intensity);
  viewfinderScreen.appendChild(holder);

  $('intensity-range').addEventListener('input', (e) => {
    state.intensity = +e.target.value;
    // live preview via CSS approximation
    const k = state.intensity / 100;
    video.style.filter = `saturate(${1 + 0.08 * k}) contrast(${1 + 0.03 * k}) brightness(${1 + 0.04 * k})`;
  });
}

function selectFilter(i) {
  state.filterIdx = i;
  document.querySelectorAll('.filter-chip').forEach((c, j) => c.classList.toggle('active', j === i));
  const f = FILTERS[i];
  const k = state.intensity / 100;
  const bright = 1 + (f.params.brightness / 180) * k;
  const contrast = 1 + (f.params.contrast / 400) * k;
  const sat = 1 + (f.params.saturation / 200) * k + (f.params.warmth / 500) * k;
  video.style.filter = `saturate(${sat.toFixed(2)}) contrast(${contrast.toFixed(2)}) brightness(${bright.toFixed(2)})`;
  toast(`滤镜：${f.name} — ${f.desc}`);
}

/* ============================================================
   mode switching (photo / gallery / about)
   ============================================================ */
modeSwitcher.addEventListener('click', (e) => {
  const label = e.target.closest('.mode-label');
  if (!label) return;
  const mode = label.dataset.mode;
  modeSwitcher.querySelectorAll('.mode-label').forEach((m) => m.classList.toggle('active', m === label));
  showOnlySection(mode);
  if (mode === 'gallery') refreshGallery();
});

const shutterHUD = $('shutter-hud');

function showOnlySection(mode) {
  // small helper used by clicking mode switcher
  viewfinderScreen.classList.toggle('hidden', mode !== 'photo');
  galleryScreen.classList.toggle('hidden', mode !== 'gallery');
  aboutScreen.classList.toggle('hidden', mode !== 'about');
  shutterHUD.classList.toggle('hidden', mode !== 'photo');
}

/* the click handler above manually shows one section; make sure it hides others */
/* (mode switching is handled entirely above) */



/* ============================================================
   hud toggles
   ============================================================ */

$('flash-selector').addEventListener('click', () => {
  const el = $('flash-selector');
  const next = el.dataset.flashState === 'on' ? 'off' : 'on';
  el.dataset.flashState = next;
  state.flash = next === 'on';
  toast(state.flash ? '闪光灯：开 ♥' : '闪光灯：关');
});

$('countdown-selector').addEventListener('click', () => {
  const el = $('countdown-selector');
  const order = ['3', '5', '10', '0'];
  const next = order[order.indexOf(el.dataset.countdown) + 1] || '3';
  el.dataset.countdown = next;
  state.countdownSec = +next;
  el.querySelector('span').textContent = next === '0' ? '即时' : `延时${next}s`;
  toast(next === '0' ? '即时拍摄，冲呀 ♥' : `延时 ${next} 秒`);
});

/* timestamp stamp: auto (per-filter) / off / real amd / fixed 2006 digicam */
const TS_MODES = [
  { id: 'auto', label: '戳·自动' },
  { id: 'now', label: '戳·此刻' },
  { id: '2006', label: `戳·'06` },
  { id: 'off', label: '戳·关' },
];

function computeStamp(pr) {
  const mode = state.timestampMode;
  if (mode === 'off') return false;
  if (mode === 'now') return TIMESTAMP_DEFAULT();
  if (mode === '2006') return `'06 ` + TIMESTAMP_DEFAULT().slice(5); // keep month/day/time
  // auto: whatever the film recipe wants
  if (pr.timestamp === true) return TIMESTAMP_DEFAULT();
  return pr.timestamp ? pr.timestamp : false;
}

$('timestamp-selector').addEventListener('click', () => {
  const el = $('timestamp-selector');
  const ids = TS_MODES.map((m) => m.id);
  const nextMode = ids[(ids.indexOf(state.timestampMode) + 1) % ids.length];
  state.timestampMode = nextMode;
  el.dataset.tsMode = nextMode;
  el.querySelector('.ts-label').textContent = TS_MODES.find((m) => m.id === nextMode).label;
  const note = { auto: '由滤镜决定', now: '拍下真实的此刻', 2006: `时间永远停在 '06 某个瞬间`, off: '不盖章' }[nextMode];
  toast(`时间戳：${note}`);
});

$('camera-switcher').addEventListener('click', () => {
  openCamera(state.facing === 'user' ? 'environment' : 'user');
});

$('aspect-selector').addEventListener('click', () => {
  const order = ['4:3', '16:9', '1:1', '3:4'];
  const next = order[(order.indexOf(state.aspect) + 1) % order.length];
  state.aspect = next;
  $('aspect-ratio-label').textContent = next;
  viewfinderScreen.classList.remove('tall', 'wide', 'square');
  if (next === '3:4') viewfinderScreen.classList.add('tall');
  if (next === '16:9') viewfinderScreen.classList.add('wide');
  if (next === '1:1') viewfinderScreen.classList.add('square');
  toast(`画幅 ${next}`);
});

$('grid-overlay-toggle').addEventListener('click', () => {
  $('viewfinder-grid-lines')?.classList.toggle('hidden');
});

$('mute-toggle').addEventListener('click', () => {
  setMuted(!muted);
  $('mute-toggle').textContent = muted ? '🔇' : '🔊';
});

$('retry-camera-btn').addEventListener('click', () => openCamera());

shutterBtn.addEventListener('click', doCapture);

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !$('viewfinder-screen').classList.contains('hidden')
      && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    doCapture();
  }
});

/* ============================================================
   toast
   ============================================================ */
function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  toastBox.appendChild(t);
  setTimeout(() => t.classList.add('leaving'), 2200);
  setTimeout(() => t.remove(), 2600);
}

/* ============================================================
   intro
   ============================================================ */
buildFilterStrip();
openCamera();
console.log('♥ naxiesian cam ready');

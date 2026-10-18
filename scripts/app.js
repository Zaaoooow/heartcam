/* ============================================================
   app.js — 那些年 · 快拍三连（digicam photobooth）
   one digicam look -> 3 shots -> photobooth paper card with date
   ============================================================ */

import { FILTERS, applyFilterToCanvas } from './filters.js';
import * as store from './storage.js';
import { playShutter, playTimerTick, playSaved, setMuted, muted } from './audio.js';

/* -------------- state -------------- */
const state = {
  stream: null,
  videoTrack: null,
  facing: 'user',
  flash: true,
  countdownSec: 3,
  aspect: '4:3',
  busy: false,
  photos: [],
  activeCollection: 'all',
  pendingBlob: null,
};

/* the single look of the machine: the 2006 digicam recipe */
const DIGI = FILTERS.find((f) => f.id === 'digicam') || FILTERS[0];

/* -------------- dom shortcuts -------------- */
const $ = (id) => document.getElementById(id);
const video = $('camera-feed');
const modeSwitcher = $('viewfinder-mode-switcher');
const galleryScreen = $('gallery-screen');
const aboutScreen = $('about-screen');
const viewfinderScreen = $('viewfinder-screen');
const shutterBtn = $('shutter-button');
const toastBox = $('toast-container');
const shutterHUD = $('shutter-hud');

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
    const msg = {
      NotAllowedError: '嗯…你没有给它摄像头权限。可以在浏览器地址栏重新允许，或者点下面再试一次。',
      NotFoundError: '好像找不到摄像头设备？换个设备试试看吧。',
      NotReadableError: '摄像头被其他程序占用啦，关掉再回来试试。',
    }[err.name] || '出现了一点问题，请检查摄像头再试试看。';
    $('camera-error-message').textContent = msg;
    $('camera-error-overlay').classList.remove('hidden');
  }
}

function updateSwitcherVisibility() {
  navigator.mediaDevices?.enumerateDevices?.().then((devs) => {
    const cams = devs.filter((d) => d.kind === 'videoinput');
    $('camera-switcher').classList.toggle('hidden', cams.length < 2);
  });
}

/* ============================================================
   capture pipeline (single shot building block)
   ============================================================ */

function computeOutputSize() {
  const srcW = video.videoWidth || 1600;
  const srcH = video.videoHeight || 1200;
  const ratio = { '4:3': 4 / 3, '16:9': 16 / 9, '1:1': 1, '3:4': 3 / 4 }[state.aspect];
  let W, H;
  if (srcW / srcH > ratio) { H = Math.min(srcH, 1400); W = Math.round(H * ratio); }
  else { W = Math.min(srcW, 1600); H = Math.round(W / ratio); }
  W -= W % 2; H -= H % 2;
  return { W, H };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function collectFlashPoints() {
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

/*
 * THE ACTUAL BUG HUNTED DOWN:
 * drawImage(video) can hand us a PARTIALLY-DECODED frame. The lower
 * scanlines of the video buffer may not be decoded yet at the exact
 * moment we snapshot (this races especially right after a torch
 * constraint toggles or the track renegotiates — i.e. booth shots 2 & 3).
 * The canvas keeps those rows TRANSPARENT, and JPEG has no alpha:
 * transparency encodes as BLACK. Top half = decoded. Bottom half = black.
 *
 * So we stop trusting the blit and MEASURE it: scan the freshly drawn
 * canvas for transparent pixels, and if any region is unpainted, wait
 * for the decoder to finish a full frame and re-blit (up to 4 times).
 */
function blitVideo() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const stage = document.createElement('canvas');
  stage.width = vw; stage.height = vh;
  const c = stage.getContext('2d', { willReadFrequently: true });
  if (state.facing === 'user') {
    c.translate(vw, 0);
    c.scale(-1, 1);
  }
  c.drawImage(video, 0, 0, vw, vh);
  return stage;
}

/** unpainted canvas rows are transparent — count them sparsely for speed */
function stageIsComplete(stage) {
  const c = stage.getContext('2d');
  const img = c.getImageData(0, 0, stage.width, stage.height).data;
  let transparent = 0, checked = 0;
  for (let i = 3; i < img.length; i += 4 * 61) {   // every ~61st pixel
    checked++;
    if (img[i] < 250) transparent++;
  }
  return transparent / Math.max(1, checked) < 0.02;
}

async function grabFullFrame() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const stage = blitVideo();
    if (stageIsComplete(stage)) {
      if (attempt > 1) console.info(`[booth] frame decoded fully on attempt ${attempt}`);
      return stage;
    }
    console.warn(`[booth] partial frame on attempt ${attempt} — waiting for decoder…`);
    await sleep(140);   // let the video decoder finish a complete frame
  }
  console.error('[booth] frame never fully decoded after 4 attempts');
  return blitVideo();   // best effort rather than nothing
}

/** center-crop a stage canvas to W×H via a source-rect draw (can't fail to cover) */
function cropStage(stage, W, H) {
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const c = out.getContext('2d');
  const vw = stage.width, vh = stage.height, AR = W / H;
  let sw, sh;
  if (vw / vh > AR) { sh = vh; sw = Math.min(vw, Math.round(vh * AR)); }
  else { sw = vw; sh = Math.min(vh, Math.round(vw / AR)); }
  const sx = (stage.width - sw) / 2;
  const sy = (stage.height - sh) / 2;
  c.drawImage(stage, sx, sy, sw, sh, 0, 0, W, H);
  return out;
}

async function countdownTick(seconds) {
  const ov = $('countdown-display-overlay');
  const val = $('countdown-value');
  ov.classList.remove('hidden');
  for (let s = seconds; s > 0; s--) {
    val.textContent = s;
    playTimerTick(false);
    await sleep(980);
  }
  ov.classList.add('hidden');
  playTimerTick(true);
}

/* ============================================================
   photobooth session: 3 shots -> one paper card
   ============================================================ */

async function shootOne() {
  const src = video;
  if (!src.videoWidth || !src.videoHeight) throw new Error('camera not ready');

  // the light IGNITES first and stays on through the grab
  let torchOn = false;
  if (state.flash) {
    torchOn = await torch(true);
    preflashOverlay();
    await sleep(torchOn ? 300 : 150);
  }

  if (state.flash) flashOverlay();      // full-viewport white light
  playShutter();
  const stage = await grabFullFrame();  // grab (and VERIFY) while the light burns
  if (torchOn) await torch(false);      // LED off only after capture

  const { W, H } = computeOutputSize();
  const raw = cropStage(stage, W, H);
  toastOnce('torch', '本机没有硬件闪光灯 → 用了全屏白光补光 ✨');

  return applyFilterToCanvas(raw, {
    filterEntry: DIGI,
    intensity: 100,
    width: W, height: H,
    mirror: false, // mirrored at grab time
    starPoints: state.flash ? collectFlashPoints() : [],
    timestampOverride: false, // the date lives on the paper card, not per-photo
  });
}

function setProgress(n) {
  const ov = $('shot-progress-overlay');
  if (!n) { ov.classList.add('hidden'); return; }
  $('shot-progress-text').textContent = `📸 快拍 ${n} / 3`;
  ov.classList.remove('hidden');
}

async function captureSession() {
  if (state.busy || !state.stream) { if (!state.stream) toast('先把摄像头打开吧 ♥'); return; }
  state.busy = true;
  shutterBtn.classList.add('cooling');

  try {
    const shots = [];
    for (let n = 1; n <= 3; n++) {
      setProgress(n);
      await countdownTick(state.countdownSec);
      shots.push(await shootOne());
      setProgress(0);
      if (n < 3) await sleep(700);
    }

    toast('三连拍完成，打印中… ♪');
    const card = composeBoothCard(shots, new Date());
    showCapturedPreview(card);
  } catch (err) {
    console.error(err);
    setProgress(0);
    toast('哎呀，出了点技术问题… 🥲');
  } finally {
    state.busy = false;
    shutterBtn.classList.remove('cooling');
  }
}

/**
 * compose the photobooth print: off-white paper card, 3 photos stacked
 * top to bottom, and the date stamped under the strip
 */
function composeBoothCard(shots, when) {
  const PW = 720, PH = 540;                 // print cell
  const PAD = 46, GAP = 22, FOOT = 120, TOP = 40;
  const CW = PAD * 2 + PW;                  // paper width
  const CH = TOP + PH * 3 + GAP * 2 + FOOT; // paper height
  const card = document.createElement('canvas');
  card.width = CW; card.height = CH;
  const ctx = card.getContext('2d', { willReadFrequently: true });

  // paper base (opaque — JPEG must never see transparency)
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, CW, CH);

  // faint print edge, like a minilab sheet
  ctx.strokeStyle = 'rgba(196,156,132,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, CW - 36, CH - 36);

  // three shots, top to bottom, cover-fitted into cells
  shots.forEach((shot, i) => {
    const dy = TOP + i * (PH + GAP);
    const s = Math.max(PW / shot.width, PH / shot.height);
    const rW = shot.width * s, rH = shot.height * s;
    ctx.drawImage(shot, PAD + (PW - rW) / 2, dy + (PH - rH) / 2, rW, rH);
  });

  // the date stamp at the bottom of the photobooth card
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}.${p(when.getMonth() + 1)}.${p(when.getDate())}  ${p(when.getHours())}:${p(when.getMinutes())}`;
  const size = 34;
  ctx.font = `bold ${size}px "Courier New", Courier, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c97b4e';
  ctx.fillText(stamp, CW / 2, TOP + PH * 3 + GAP * 2 + FOOT / 2 + 6);

  return card;
}

/* preview + save/discard */
function showCapturedPreview(canvas) {
  const img = $('captured-photo-img');
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    img.src = url;
    img.dataset.blobUrl = url;
    state.pendingBlob = blob;
    $('captured-photo-preview-overlay').classList.remove('hidden');
  }, 'image/jpeg', 0.93);
}

$('save-photo-btn').addEventListener('click', async () => {
  if (!state.pendingBlob) return;
  try {
    await store.savePhoto(state.pendingBlob, {
      filter: 'digicam',
      filterName: '快拍三连',
      ts: Date.now(),
      aspect: state.aspect,
    });
    playSaved();
    toast('收进相册啦 ♥');
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
  state.pendingBlob = null;
}

/* ============================================================
   gallery
   ============================================================ */

async function refreshGallery() {
  try {
    state.photos = (await store.listPhotos()).sort((a, b) => b.meta.ts - a.meta.ts);
  } catch {
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

  // collections: "all" + one per saved kind
  const kinds = [{ id: 'all', label: `全部 (${all.length})` }];
  const seen = new Map();
  for (const ph of all) {
    if (!seen.has(ph.meta.filter)) seen.set(ph.meta.filter, ph.meta.filterName);
  }
  for (const [id, label] of seen) kinds.push({ id, label });

  nav.innerHTML = '';
  for (const k of kinds) {
    const b = document.createElement('button');
    b.className = 'collection-btn' + (state.activeCollection === k.id ? ' active' : '');
    b.textContent = k.label;
    b.onclick = () => { state.activeCollection = k.id; renderGallery(); };
    nav.appendChild(b);
  }

  const list = state.activeCollection === 'all'
    ? all
    : all.filter((ph) => ph.meta.filter === state.activeCollection);

  empty.classList.toggle('hidden', list.length > 0);

  list.forEach((ph, idx) => {
    const url = URL.createObjectURL(ph.blob);
    const cardEl = document.createElement('div');
    cardEl.className = 'photo-card';
    cardEl.style.setProperty('--tilt', `${(((idx * 37) % 7) - 3) * 0.8}deg`);

    const img = new Image();
    img.src = url;
    img.loading = 'lazy';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const d = new Date(ph.meta.ts);
    const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    meta.innerHTML = `<span>♥ ${ph.meta.filterName}</span><span style="display:flex;align-items:center;gap:6px"><span>${dateStr}</span><button class="delete-btn" title="删除">×</button></span>`;

    cardEl.appendChild(img);
    cardEl.appendChild(meta);
    img.onload = () => URL.revokeObjectURL(url);

    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) return;
      openLightbox(ph);
    });
    meta.querySelector('.delete-btn').addEventListener('click', async () => {
      await store.deletePhoto(ph.id);
      refreshGallery();
      toast('删掉啦');
    });

    grid.appendChild(cardEl);
  });
}

/* lightbox */
function openLightbox(photo) {
  store.blobToDataURL(photo.blob).then((url) => {
    $('lightbox-img').src = url;
    const dl = $('lightbox-download-btn');
    dl.href = url;
    const d = new Date(photo.meta.ts);
    const p = (n) => String(n).padStart(2, '0');
    dl.download = `digibooth_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.jpg`;
  });
  $('lightbox-overlay').classList.remove('hidden');
}
$('lightbox-close-btn').addEventListener('click', () => $('lightbox-overlay').classList.add('hidden'));
$('lightbox-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox-overlay') $('lightbox-overlay').classList.add('hidden');
});

/* ============================================================
   mode switching (photo / gallery / about)
   ============================================================ */
modeSwitcher.addEventListener('click', (e) => {
  const label = e.target.closest('.mode-label');
  if (!label) return;
  const mode = label.dataset.mode;
  modeSwitcher.querySelectorAll('.mode-label').forEach((m) => m.classList.toggle('active', m === label));
  viewfinderScreen.classList.toggle('hidden', mode !== 'photo');
  galleryScreen.classList.toggle('hidden', mode !== 'gallery');
  aboutScreen.classList.toggle('hidden', mode !== 'about');
  shutterHUD.classList.toggle('hidden', mode !== 'photo');
  if (mode === 'gallery') refreshGallery();
});

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
  toast(next === '0' ? '风一样的三连拍 ♥' : `每张延时 ${next} 秒`);
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

shutterBtn.addEventListener('click', captureSession);

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !$('viewfinder-screen').classList.contains('hidden')
      && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
    e.preventDefault();
    captureSession();
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

const _toastOnceSet = new Set();
function toastOnce(key, text) {
  if (_toastOnceSet.has(key)) return;
  _toastOnceSet.add(key);
  toast(text);
}

/* ============================================================
   intro
   ============================================================ */
openCamera();
console.log('♥ digibooth ready — one look, three shots, one paper card');

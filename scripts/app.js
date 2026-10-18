/* ============================================================
   app.js v7 — 那些年 · 快拍三连 (digicam photobooth)
   two capture modes: RAW (no processing) | 2006 DIGICAM (film lab)
   EN / 中文 switchable
   ============================================================ */

import * as store from './storage.js?v=8';
import { playShutter, playTimerTick, playSaved, setMuted, muted } from './audio.js?v=8';

const BUILD = "v8";

/* ============================================================
   i18n — English / 中文
   ============================================================ */
const LANGS = {
  zh: {
    title: '那些年 · 快拍三连',
    tagline: '③ 连拍 ▸ 相纸卡打印 ▸ 底部盖日期章',
    mode_photo: '拍照', mode_gallery: '相册', mode_about: '关于',
    grid_title: '切换九宫格', mute_title: '切换静音', lang_title: 'Switch to English',
    loading_h4: '请求摄像头权限…',
    loading_p: '浏览器需要你的同意才能开始取景哦。<br>如果已拒绝，请到浏览器地址栏的权限设置里重新允许。',
    err_h4: '取景失败',
    err_default: '出现了一点问题，请检查摄像头再试试看。',
    err_notAllowed: '嗯…你没有给它摄像头权限。可以在浏览器地址栏重新允许，或者点下面再试一次。',
    err_notFound: '好像找不到摄像头设备？换个设备试试看吧。',
    err_notReadable: '摄像头被其他程序占用啦，关掉再回来试试。',
    retry: '再试一次',
    hud_flash: '闪光', hud_countdown: '延时', hud_flip: '翻转',
    hud_timer_instant: '即时', hud_timer_fmt: '延时{n}s',
    shutter_label: '拍照',
    progress_fmt: '📸 快拍 {n} / 3',
    caption: '三连拍完成，收好这张纸 ♥',
    save: '保存到相册', discard: '不要啦',
    album_title: '我的相册',
    album_empty_h4: '相册里空空的', album_empty_p: '快去拍点照片存进来吧 ♥',
    about_title: '关于小站',
    about_p1: '「那些年 · 快拍三连」是一台纯前端的怀旧风数码快拍机 —— 画面零处理，所见即所拍：',
    about_li1: '按一次快门 = 连拍 3 张（延时、闪光灯各自控制）',
    about_li2: '自动打印「相纸卡」：3 张照片纵向排列，最底部盖上日期章',
    about_li3: '照片卡收进相册（IndexedDB），可一键下载原图',
    about_footer: '所有照片都保存在你自己的浏览器里，不会上传。<br>今天也要开心呀 ♥',
    dl: '下载原图', close: '关闭',
    f_raw: 'RAW 原图', f_raw_en: 'straight capture',
    f_digi: '2006 DIGICAM', f_digi_en: 'film lab',
    t_noCamera: '先把摄像头打开吧 ♥',
    t_noTorch: '本机没有硬件闪光灯 → 用了全屏白光补光 ✨',
    t_err: '哎呀，出了点技术问题… 🥲',
    t_camera_ready: '摄像头还没准备好，稍等一秒再按一次吧',
    t_printing: '三连拍完成，打印中… ♪',
    t_saved: '收进相册啦 ♥',
    t_album_full: '相册似乎满了？删一些照片再来试试。',
    t_deleted: '删掉啦',
    t_flash_on: '闪光灯：开 ♥', t_flash_off: '闪光灯：关',
    t_instant: '风一样的三连拍 ♥', t_timer_fmt: '每张延时 {n} 秒',
    t_aspect: '画幅 {r}',
    t_filter_fmt: '滤镜：{n}',
  },
  en: {
    title: 'Naxiesian · Digibooth',
    tagline: '3-shot strip ▸ paper print ▸ date stamped below',
    mode_photo: 'Photo', mode_gallery: 'Album', mode_about: 'About',
    grid_title: 'Toggle grid', mute_title: 'Toggle sound', lang_title: '切换到中文',
    loading_h4: 'Requesting camera access…',
    loading_p: 'Your browser needs permission to start the viewfinder.<br>If you denied it, re-allow it in the address-bar site settings.',
    err_h4: 'Viewfinder failed',
    err_default: 'Something went wrong — check your camera and try again.',
    err_notAllowed: "Hmm… camera permission was denied. Re-allow it in the address bar, or press try again below.",
    err_notFound: "No camera device found? Try another device.",
    err_notReadable: 'The camera is busy in another app — close it and come back.',
    retry: 'Try again',
    hud_flash: 'Flash', hud_countdown: 'Timer', hud_flip: 'Flip',
    hud_timer_instant: 'Instant', hud_timer_fmt: '{n}s',
    shutter_label: 'Take photo',
    progress_fmt: '📸 Shot {n} / 3',
    caption: 'Three shots done — keep this one ♥',
    save: 'Save to album', discard: 'Discard',
    album_title: 'My album',
    album_empty_h4: 'The album is empty', album_empty_p: 'Go take some photos and save them here ♥',
    about_title: 'About',
    about_p1: 'A nostalgic digibooth running entirely in your browser — zero pixel processing, what you see is what the camera saw:',
    about_li1: 'One shutter press = 3 shots (timer and flash each control theirs)',
    about_li2: 'They print as a photobooth card: three photos stacked top to bottom, date stamped under the strip',
    about_li3: 'Cards are kept in your album (IndexedDB) — download the full print anytime',
    about_footer: 'Every photo stays in your browser; nothing is uploaded.<br>Have a lovely day ♥',
    dl: 'Download', close: 'Close',
    f_raw: 'RAW', f_raw_en: 'straight capture',
    f_digi: '2006 DIGICAM', f_digi_en: 'film lab',
    t_noCamera: 'Start the camera first ♥',
    t_noTorch: 'No hardware flash → used a full-screen white light ✨',
    t_err: 'Oops, something broke… 🥲',
    t_camera_ready: "Camera isn't ready — wait a second and press again",
    t_printing: 'Three shots done, printing… ♪',
    t_saved: 'Saved to your album ♥',
    t_album_full: 'Album seems full — delete a few and try again.',
    t_deleted: 'Deleted',
    t_flash_on: 'Flash: on ♥', t_flash_off: 'Flash: off',
    t_instant: 'Instant 3-shot ♥', t_timer_fmt: '{n}s before each shot',
    t_aspect: 'Aspect {r}',
    t_filter_fmt: 'Filter: {n}',
  },
};

let lang = (() => {
  try { return localStorage.getItem('naxiesian-lang') || 'zh'; } catch { return 'zh'; }
})();

function t(key, vars) {
  let s = (LANGS[lang] && LANGS[lang][key]) ?? LANGS.zh[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  $('lang-toggle').textContent = lang === 'zh' ? 'EN' : '中';
  refreshDynamicText();
}

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
let errMessageKey = 'err_default';

async function openCamera(facing = state.facing) {
  try {
    $('camera-loading-overlay').classList.remove('hidden');
    $('camera-error-overlay').classList.add('hidden');
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } },
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
    errMessageKey = {
      NotAllowedError: 'err_notAllowed',
      NotFoundError: 'err_notFound',
      NotReadableError: 'err_notReadable',
    }[err.name] || 'err_default';
    $('camera-error-message').textContent = t(errMessageKey);
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
   capture pipeline
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

function blitVideo() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const stage = document.createElement('canvas');
  stage.width = vw; stage.height = vh;
  const c = stage.getContext('2d', { willReadFrequently: true });
  if (state.facing === 'user') { c.translate(vw, 0); c.scale(-1, 1); }
  c.drawImage(video, 0, 0, vw, vh);
  return stage;
}

function stageIsComplete(stage) {
  const c = stage.getContext('2d');
  const img = c.getImageData(0, 0, stage.width, stage.height).data;
  let transparent = 0, checked = 0;
  for (let i = 3; i < img.length; i += 4 * 61) {
    checked++;
    if (img[i] < 250) transparent++;
  }
  return transparent / Math.max(1, checked) < 0.02;
}

function bandMeanLum(d, W, y0, y1, step = 4) {
  let sum = 0, n = 0;
  for (let y = Math.max(0, y0); y < y1; y += step) {
    for (let x = 0; x < W; x += 61) {
      const i = (y * W + x) * 4;
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n++;
    }
  }
  return n ? sum / n : 0;
}

function bandLooksAlive(d, W, H) {
  const top = bandMeanLum(d, W, 0, Math.floor(H * 0.3));
  const bottom = bandMeanLum(d, W, Math.floor(H * 0.7), H);
  return !(top > 22 && bottom < top * 0.22);
}

function stageLooksSane(stage) {
  const d = stage.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, stage.width, stage.height).data;
  return bandLooksAlive(d, stage.width, stage.height);
}

async function grabFullFrame() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const stage = blitVideo();
    if (stageIsComplete(stage) && stageLooksSane(stage)) {
      if (attempt > 1) console.info(`[booth] clean frame on attempt ${attempt}`);
      return stage;
    }
    console.warn(`[booth] half frame on attempt ${attempt} — re-grabbing…`);
    await sleep(150);
  }
  console.error('[booth] could not obtain a clean frame after 5 attempts');
  return blitVideo();
}

function cropStage(stage, W, H) {
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const c = out.getContext('2d', { willReadFrequently: true });
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);   // opaque base: JPEG must never see transparency
  const vw = stage.width, vh = stage.height, AR = W / H;
  let sw, sh;
  if (vw / vh > AR) { sh = vh; sw = Math.min(vw, Math.round(vh * AR)); }
  else { sw = vw; sh = Math.min(vh, Math.round(vw / AR)); }
  const sx = (stage.width - sw) / 2;
  const sy = (stage.height - sh) / 2;
  c.drawImage(stage, sx, sy, sw, sh, 0, 0, W, H);
  return out;
}

/* guard on the finished shot: nothing half-black reaches the paper card */
function verifyFullFrame(canvas) {
  const W = canvas.width, H = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  return bandLooksAlive(d, W, H);
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
   one shot — ZERO pixel processing.

   The film lab was removed here on purpose: its per-pixel stages
   (noise injection, YCbCr chroma reconstruction) could write NaN into
   a Uint8ClampedArray, which stores as 0 — a black band. A photo is
   now exactly what the camera saw: blit -> aspect crop -> print.
   Future looks will use CSS filters or WebGL (GPU-composited), which
   never round-trip pixels through JS.
   ============================================================ */
async function shootOne() {
  const src = video;
  if (!src.videoWidth || !src.videoHeight) throw new Error('camera not ready');

  let torchOn = false;
  if (state.flash) {
    torchOn = await torch(true);
    preflashOverlay();
    await sleep(torchOn ? 300 : 150);
  }

  if (state.flash) flashOverlay();
  playShutter();
  const stage = await grabFullFrame();
  if (torchOn) await torch(false);

  const { W, H } = computeOutputSize();
  return cropStage(stage, W, H);
}

/* ============================================================
   photobooth session: 3 shots -> one paper card
   ============================================================ */
function setProgress(n) {
  const ov = $('shot-progress-overlay');
  if (!n) { ov.classList.add('hidden'); return; }
  $('shot-progress-text').textContent = t('progress_fmt', { n });
  ov.classList.remove('hidden');
}

async function captureSession() {
  if (state.busy || !state.stream) { if (!state.stream) toast(t('t_noCamera')); return; }
  state.busy = true;
  shutterBtn.classList.add('cooling');

  try {
    const shots = [];
    for (let n = 1; n <= 3; n++) {
      setProgress(n);
      await countdownTick(state.countdownSec);
      let shot = await shootOne();
      if (!verifyFullFrame(shot)) {
        console.warn(`[booth] shot ${n} incomplete — retaking`);
        await sleep(300);
        await countdownTick(Math.min(3, state.countdownSec));
        shot = await shootOne();
      }
      shots.push(shot);
      setProgress(0);
      if (n < 3) await sleep(700);
    }

    toast(t('t_printing'));
    const card = composeBoothCard(shots, new Date());
    showCapturedPreview(card);
  } catch (err) {
    console.error(err);
    setProgress(0);
    toast(t('t_err'));
  } finally {
    state.busy = false;
    shutterBtn.classList.remove('cooling');
  }
}

function composeBoothCard(shots, when) {
  const PW = 720, PH = 540;
  const PAD = 46, GAP = 22, FOOT = 120, TOP = 40;
  const CW = PAD * 2 + PW;
  const CH = TOP + PH * 3 + GAP * 2 + FOOT;
  const card = document.createElement('canvas');
  card.width = CW; card.height = CH;
  const ctx = card.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, CW, CH);
  ctx.strokeStyle = 'rgba(196,156,132,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, CW - 36, CH - 36);

  shots.forEach((shot, i) => {
    const dy = TOP + i * (PH + GAP);
    const s = Math.max(PW / shot.width, PH / shot.height);
    const rW = shot.width * s, rH = shot.height * s;
    ctx.drawImage(shot, PAD + (PW - rW) / 2, dy + (PH - rH) / 2, rW, rH);
  });

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
      filter: 'capture',
      filterName: lang === 'zh' ? '原图' : 'RAW',
      ts: Date.now(),
      aspect: state.aspect,
    });
    playSaved();
    toast(t('t_saved'));
  } catch (e) {
    console.error('save fail', e);
    toast(t('t_album_full'));
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

  const kinds = [{ id: 'all', label: lang === 'zh' ? `全部 (${all.length})` : `All (${all.length})` }];
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
      toast(t('t_deleted'));
    });

    grid.appendChild(cardEl);
  });
}

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
   mode switching (photo / album / about)
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
function refreshDynamicText() {
  const el = $('countdown-selector');
  if (!el) return;
  el.querySelector('span').textContent = state.countdownSec === 0
    ? t('hud_timer_instant')
    : t('hud_timer_fmt', { n: state.countdownSec });
}

$('lang-toggle').addEventListener('click', () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  try { localStorage.setItem('naxiesian-lang', lang); } catch {}
  applyLang();
  $('camera-error-message').textContent = t(errMessageKey);
});

$('flash-selector').addEventListener('click', () => {
  const el = $('flash-selector');
  const next = el.dataset.flashState === 'on' ? 'off' : 'on';
  el.dataset.flashState = next;
  state.flash = next === 'on';
  toast(state.flash ? t('t_flash_on') : t('t_flash_off'));
});

$('countdown-selector').addEventListener('click', () => {
  const el = $('countdown-selector');
  const order = ['3', '5', '10', '0'];
  const next = order[order.indexOf(el.dataset.countdown) + 1] || '3';
  el.dataset.countdown = next;
  state.countdownSec = +next;
  refreshDynamicText();
  toast(next === '0' ? t('t_instant') : t('t_timer_fmt', { n: next }));
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
  toast(t('t_aspect', { r: next }));
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
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  toastBox.appendChild(el);
  setTimeout(() => el.classList.add('leaving'), 2200);
  setTimeout(() => el.remove(), 2600);
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
$('build-badge').textContent = `build ${BUILD}`;
applyLang();
openCamera();
console.log(`♥ digibooth ${BUILD} — zero pixel processing — three shots, one paper card`);
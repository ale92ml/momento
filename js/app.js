// app.js — interfaz de Momento.

import * as db from './db.js';
import {
  FAMILIES,
  OTHER_FAMILY,
  familyOf,
  familyForWord,
  PLACES,
  COMPANY,
  labelFor,
  intensityLabel,
  loadCustomWords,
  rememberCustomWord,
} from './emotions.js';
import { processPhoto, blobToDataURL, dataURLToBlob, MAX_PHOTOS, photoIdsOf } from './photo.js';
import {
  fmtTime,
  fmtFull,
  fmtShortDate,
  fmtDayLabel,
  groupByDay,
  dayKey,
  toLocalInputValue,
  fromLocalInputValue,
  escapeHtml as esc,
  formatBytes,
} from './format.js';
import { summarize, filterLastDays, weeklyBalance } from './stats.js';
import { statsGrid, familyList, wordsCloud, stackedRows, calendarChart, famColor, emotionTags, balanceChart } from './charts.js';
import { skyFor, greetingFor, skyVars, skyLayers } from './sky.js';
import { buildReport, standaloneHTML, shareOrDownload } from './report.js';
import {
  PRESETS,
  effective,
  setFamilyColor,
  setAccent,
  resetMode,
  resetAll,
  applyPreset,
  isPresetActive,
  applyColors,
  customReportCSS,
  checkPalette,
} from './colors.js';
import { STACK_ORDER } from './emotions.js';

const APP_VERSION = '1.2.0';
const DAY_MS = 86400000;
const THEME_KEY = 'momento.theme';
const PERSIST_KEY = 'momento.persist';
const LOCK_AFTER_MS = 2 * 60 * 1000;
const ONBOARD_KEY = 'momento.onboarded';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const els = {
  view: $('#view'),
  title: $('#title'),
  back: $('#backBtn'),
  actions: $('#topActions'),
  tabbar: $('#tabbar'),
  toast: $('#toast'),
  lock: $('#lock'),
  lockForm: $('#lockForm'),
  lockPin: $('#lockPin'),
  lockError: $('#lockError'),
  lockMsg: $('#lockMsg'),
};

const state = {
  entries: null,
  thumbs: new Map(),
  fullURLs: [],
  filter: { q: '', fam: null },
  range: 30,
  hasPin: false,
  hiddenAt: null,
  editing: false,
  installPrompt: null,
  colorsMode: null,
  onLeave: null,
};

const ICON_EDIT =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const ICON_PLUS_SM =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_CHEVRON =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_ZOOM =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_STAR =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" fill="currentColor"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

// ---------- utilidades de interfaz ----------

let toastTimer = null;
function toast(msg, { ms = 2400, onClick = null } = {}) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  els.toast.classList.toggle('clickable', !!onClick);
  els.toast.onclick = onClick;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), ms);
}

function setChrome({ title, back = false, actions = '' }) {
  els.title.textContent = title;
  els.back.hidden = !back;
  els.actions.innerHTML = actions;
}

function render(html, { sticky = false } = {}) {
  els.view.innerHTML = html;
  els.view.classList.toggle('has-sticky', sticky);
  window.scrollTo(0, 0);
}

function setActiveTab(name) {
  $$('a', els.tabbar).forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
}

function go(hash) {
  location.hash = hash;
}

function applyTheme() {
  let t = 'system';
  try {
    t = localStorage.getItem(THEME_KEY) || 'system';
  } catch (e) {}
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// ---------- datos en memoria ----------

async function getEntries() {
  if (!state.entries) state.entries = await db.listEntries();
  return state.entries;
}

function upsertEntry(entry) {
  const list = state.entries || [];
  const i = list.findIndex((e) => e.id === entry.id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  list.sort((a, b) => b.createdAt - a.createdAt);
  state.entries = list;
}

function removeEntry(id) {
  state.entries = (state.entries || []).filter((e) => e.id !== id);
}

async function thumbURL(photoId) {
  if (state.thumbs.has(photoId)) return state.thumbs.get(photoId);
  try {
    const blob = await db.getThumb(photoId);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    state.thumbs.set(photoId, url);
    return url;
  } catch (e) {
    return null;
  }
}

function forgetThumb(photoId) {
  const url = state.thumbs.get(photoId);
  if (url) URL.revokeObjectURL(url);
  state.thumbs.delete(photoId);
}

function clearThumbs() {
  for (const url of state.thumbs.values()) URL.revokeObjectURL(url);
  state.thumbs.clear();
}

async function hydrateThumbs(root) {
  for (const img of $$('img[data-photo]', root)) {
    const url = await thumbURL(img.dataset.photo);
    if (url) img.src = url;
    else img.remove();
  }
}

function releaseFull() {
  for (const url of state.fullURLs) URL.revokeObjectURL(url);
  state.fullURLs = [];
}

// ---------- visor de foto a pantalla completa ----------

let lightbox = null;

const ICON_SHARE =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 13v6h14v-6" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_PREV =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NEXT =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Abre una o varias fotos encima de todo. `items` es [{ url, blob }]; `index` la primera que se ve.
 * Pellizco para ampliar, arrastre, doble toque, deslizar para pasar de foto y compartir con la hoja nativa.
 */
function openLightbox(items, index = 0) {
  if (lightbox) closeLightbox({ silent: true });
  const list = Array.isArray(items) ? items : [{ url: items }];
  if (!list.length) return;
  let idx = Math.max(0, Math.min(list.length - 1, index));
  const many = list.length > 1;

  const el = document.createElement('div');
  el.className = 'lightbox';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Foto ampliada');
  el.innerHTML = `<div class="lb-top">
      <span class="lb-count"></span>
      <span class="lb-spacer"></span>
      <button type="button" class="lb-btn lb-share" aria-label="Compartir foto">${ICON_SHARE}</button>
      <button type="button" class="lb-btn lb-close" aria-label="Cerrar">${ICON_CLOSE}</button>
    </div>
    <div class="lb-stage"><img alt="" draggable="false" /></div>
    ${many ? `<button type="button" class="lb-btn lb-nav lb-prev" aria-label="Anterior">${ICON_PREV}</button><button type="button" class="lb-btn lb-nav lb-next" aria-label="Siguiente">${ICON_NEXT}</button>` : ''}
    <div class="lb-hint">${many ? 'Desliza para pasar de foto · ' : ''}Pellizca o toca dos veces para ampliar</div>`;
  document.body.appendChild(el);
  document.body.classList.add('lb-open');
  try {
    history.pushState({ lightbox: true }, '');
  } catch (e) {}
  lightbox = { el, pushed: true };

  const stage = $('.lb-stage', el);
  const img = $('img', el);
  const hint = $('.lb-hint', el);
  const count = $('.lb-count', el);
  const shareBtn = $('.lb-share', el);
  let scale = 1;
  let tx = 0;
  let ty = 0;
  const pointers = new Map();
  let pinch = null;
  let lastTap = 0;
  let moved = false;
  let swipe = null;

  const apply = () => {
    if (scale <= 1.001) {
      scale = 1;
      tx = 0;
      ty = 0;
    } else {
      const r = stage.getBoundingClientRect();
      const maxX = ((scale - 1) * r.width) / 2;
      const maxY = ((scale - 1) * r.height) / 2;
      tx = Math.max(-maxX, Math.min(maxX, tx));
      ty = Math.max(-maxY, Math.min(maxY, ty));
    }
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    el.classList.toggle('zoomed', scale > 1);
  };
  const zoomAt = (factor, cx, cy) => {
    const r = stage.getBoundingClientRect();
    const px = cx - r.left - r.width / 2;
    const py = cy - r.top - r.height / 2;
    const next = Math.max(1, Math.min(5, scale * factor));
    const k = next / scale;
    tx = px - (px - tx) * k;
    ty = py - (py - ty) * k;
    scale = next;
    apply();
  };
  const show = (i) => {
    idx = (i + list.length) % list.length;
    scale = 1;
    apply();
    img.src = list[idx].url;
    count.textContent = many ? `${idx + 1} / ${list.length}` : '';
    el.classList.toggle('first', idx === 0);
    el.classList.toggle('last', idx === list.length - 1);
  };
  show(idx);
  if (!(navigator.share || list[idx].blob)) shareBtn.hidden = true;

  stage.addEventListener('pointerdown', (ev) => {
    stage.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    moved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      swipe = null;
    } else if (pointers.size === 1 && scale === 1 && many) {
      swipe = { x: ev.clientX, y: ev.clientY, dx: 0 };
    }
  });
  stage.addEventListener('pointermove', (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    const cur = { x: ev.clientX, y: ev.clientY };
    if (pointers.size === 2 && pinch) {
      pointers.set(ev.pointerId, cur);
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const target = Math.max(1, Math.min(5, (pinch.scale * dist) / (pinch.dist || 1)));
      zoomAt(target / scale, (a.x + b.x) / 2, (a.y + b.y) / 2);
      moved = true;
      return;
    }
    if (pointers.size === 1 && scale > 1) {
      tx += cur.x - prev.x;
      ty += cur.y - prev.y;
      if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 1) moved = true;
      apply();
    } else if (pointers.size === 1 && swipe) {
      swipe.dx = cur.x - swipe.x;
      if (Math.abs(swipe.dx) > 6) moved = true;
      img.style.transform = `translate(${swipe.dx}px, 0)`;
    }
    pointers.set(ev.pointerId, cur);
  });
  const up = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (swipe && pointers.size === 0) {
      const dx = swipe.dx;
      swipe = null;
      if (Math.abs(dx) > 60) {
        show(dx < 0 ? idx + 1 : idx - 1);
        hint.hidden = true;
        return;
      }
      apply();
    }
    if (ev.type === 'pointerup' && pointers.size === 0 && !moved) {
      const now = Date.now();
      if (now - lastTap < 320) {
        if (scale > 1) {
          scale = 1;
          apply();
        } else zoomAt(2.5, ev.clientX, ev.clientY);
        lastTap = 0;
      } else lastTap = now;
      hint.hidden = true;
    }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      zoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX, ev.clientY);
    },
    { passive: false }
  );
  el.addEventListener('click', (ev) => {
    if (ev.target.closest('.lb-close')) closeLightbox();
    else if (ev.target.closest('.lb-prev')) show(idx - 1);
    else if (ev.target.closest('.lb-next')) show(idx + 1);
    else if (ev.target.closest('.lb-share')) sharePhoto(list[idx]);
  });
  lightbox.onKey = (ev) => {
    if (ev.key === 'ArrowRight' && many) show(idx + 1);
    else if (ev.key === 'ArrowLeft' && many) show(idx - 1);
  };
  setTimeout(() => (hint.hidden = true), 2800);
}

async function sharePhoto(item) {
  try {
    let blob = item.blob;
    if (!blob) blob = await (await fetch(item.url)).blob();
    const file = new File([blob], `momento-${dayKey(Date.now())}.jpg`, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Foto de Momento' });
      return;
    }
    const r = await shareOrDownload(blob, file.name, 'Foto de Momento');
    if (r === 'downloaded') toast('Foto descargada');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('No se pudo compartir la foto');
  }
}

function closeLightbox({ silent = false } = {}) {
  if (!lightbox) return;
  const { el, pushed } = lightbox;
  lightbox = null;
  el.remove();
  document.body.classList.remove('lb-open');
  if (pushed && !silent) history.back();
}

window.addEventListener('popstate', () => {
  if (lightbox) closeLightbox({ silent: true });
});
document.addEventListener('keydown', (ev) => {
  if (!lightbox) return;
  if (ev.key === 'Escape') closeLightbox();
  else if (lightbox.onKey) lightbox.onKey(ev);
});

// ---------- bloqueo ----------

function showLock(msg) {
  els.lockMsg.textContent = msg || 'Introduce tu PIN para abrir el diario.';
  els.lockError.hidden = true;
  els.lockPin.value = '';
  els.lock.hidden = false;
  setTimeout(() => els.lockPin.focus(), 60);
}

els.lockForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const pin = els.lockPin.value.trim();
  if (!pin) return;
  const btn = $('button', els.lockForm);
  btn.disabled = true;
  try {
    await db.unlock(pin);
    els.lock.hidden = true;
    if (!state.editing) {
      state.entries = null;
      await route();
    }
    maybeOnboard();
  } catch (e) {
    els.lockError.textContent = e.message || 'PIN incorrecto';
    els.lockError.hidden = false;
    els.lockPin.value = '';
    els.lockPin.focus();
  } finally {
    btn.disabled = false;
  }
});

els.lockPin.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    if (els.lockForm.requestSubmit) els.lockForm.requestSubmit();
    else els.lockForm.dispatchEvent(new Event('submit', { cancelable: true }));
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    state.hiddenAt = Date.now();
    return;
  }
  if (state.hasPin && state.hiddenAt && Date.now() - state.hiddenAt > LOCK_AFTER_MS && db.isUnlocked()) {
    db.lock();
    state.entries = null;
    clearThumbs();
    showLock();
  }
});

// ---------- rutas ----------

const routes = {
  '': viewHome,
  new: () => viewEditor(null),
  entry: viewDetail,
  edit: viewEditor,
  patterns: viewPatterns,
  settings: viewSettings,
  report: viewReport,
  colors: viewColors,
};

async function route() {
  releaseFull();
  if (state.onLeave) {
    const fn = state.onLeave;
    state.onLeave = null;
    try {
      fn();
    } catch (e) {}
  }
  if (!db.isUnlocked()) {
    showLock();
    return;
  }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = parts[0] || '';
  const arg = parts[1];
  const fn = routes[name] || viewHome;
  state.editing = name === 'new' || name === 'edit';
  try {
    await fn(arg);
  } catch (e) {
    console.error(e);
    render(`<div class="empty"><strong>Algo ha fallado</strong>${esc(e.message || String(e))}</div>`);
  }
}

window.addEventListener('hashchange', route);
els.back.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else go('#/');
});

// ---------- diario ----------

function primaryOf(e) {
  return (e.emotions && e.emotions[0] && e.emotions[0].family) || 'otra';
}

/** Intensidad de una emoción concreta; las anotaciones antiguas solo tienen una global. */
function emIntensity(e, em) {
  const v = em && em.intensity != null ? Number(em.intensity) : Number(e.intensity);
  return Math.max(0, Math.min(10, Math.round(v || 0)));
}

/** True si la anotación tiene varias emociones con intensidades distintas. */
function hasMixedIntensity(e) {
  const list = e.emotions || [];
  if (list.length < 2) return false;
  const first = emIntensity(e, list[0]);
  return list.some((em) => emIntensity(e, em) !== first);
}

function entryRow(e) {
  const i = Number(e.intensity) || 0;
  const mixed = hasMixedIntensity(e);
  const words = (e.emotions || [])
    .map(
      (em) =>
        `<span class="w" style="--c:${famColor(em.family || 'otra')}"><i class="dot"></i>${esc(em.word)}${mixed ? `<small>${emIntensity(e, em)}</small>` : ''}</span>`
    )
    .join('');
  const note = e.note ? `<div class="note">${esc(e.note)}</div>` : '';
  const pids = photoIdsOf(e);
  const thumb = pids.length
    ? `<span class="thumb-wrap"><img class="thumb" data-photo="${esc(pids[0])}" alt="" />${pids.length > 1 ? `<span class="thumb-n">+${pids.length - 1}</span>` : ''}</span>`
    : '';
  return `<a class="entry${pids.length ? ' has-thumb' : ''}" href="#/entry/${esc(e.id)}">
    <div class="time">${esc(fmtTime(e.createdAt))}<small>${i}/10</small></div>
    <div><div class="words">${words}</div>${note}<div class="meter" style="--c:${famColor(primaryOf(e))}"><i style="width:${i * 10}%"></i></div></div>
    ${thumb}
  </a>`;
}

function heroHTML() {
  const now = Date.now();
  const key = skyFor(now);
  return `<a class="hero sky-${key}" href="#/new" style="${skyVars(key)}">${skyLayers(key)}<span class="hero-text"><span class="hero-greet">${esc(greetingFor(now))} · ${esc(fmtTime(now))}</span><span class="hero-title">¿Cómo te sientes ahora?</span></span><span class="hero-cta">${ICON_PLUS_SM} Anotar</span></a>`;
}

function emptyState() {
  return `<div class="empty">
    <svg class="empty-art" viewBox="0 0 200 140" width="190" height="133" aria-hidden="true"><circle cx="100" cy="86" r="34" fill="var(--sun)" opacity="0.95"></circle><rect x="0" y="86" width="200" height="54" fill="var(--bg)"></rect><line x1="24" y1="86" x2="176" y2="86" stroke="var(--line-strong)" stroke-width="3" stroke-linecap="round"></line><circle cx="52" cy="112" r="4" fill="var(--fam-tristeza)"></circle><circle cx="82" cy="118" r="4" fill="var(--fam-calma)"></circle><circle cx="116" cy="116" r="4" fill="var(--fam-alegria)"></circle><circle cx="148" cy="110" r="4" fill="var(--fam-miedo)"></circle></svg>
    <strong>Todavía no hay nada</strong>Cuando notes algo, lo que sea, pulsa el botón y ponle nombre. Veinte segundos bastan.
    <span class="small muted" style="display:block;margin-top:6px">No hace falta que sea importante. Un atardecer vale.</span>
  </div>`;
}

function detailTitle(e) {
  const note = (e.note || '').trim();
  if (note) {
    let first = note.split(/[.!?\n]/)[0].trim();
    if (first.length > 46) first = first.slice(0, 45).replace(/\s+\S*$/, '') + '…';
    if (first) return first;
  }
  const w = e.emotions && e.emotions[0] ? e.emotions[0].word : 'Anotación';
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Filtra el diario por texto (palabra, nota, pensamiento) y por familia (cualquiera de sus emociones). */
function filterEntries(entries, { q, fam }) {
  const needle = (q || '').trim().toLowerCase();
  if (!needle && !fam) return entries;
  return entries.filter((e) => {
    const ems = e.emotions || [];
    if (fam && !ems.some((em) => (em.family || 'otra') === fam)) return false;
    if (!needle) return true;
    return (
      ems.some((em) => (em.word || '').toLowerCase().includes(needle)) ||
      (e.note || '').toLowerCase().includes(needle) ||
      (e.thought || '').toLowerCase().includes(needle)
    );
  });
}

async function viewHome() {
  setChrome({ title: 'Momento' });
  setActiveTab('home');
  const entries = await getEntries();
  const f = state.filter;
  const famChips = FAMILIES.map(
    (fm) =>
      `<button type="button" class="chip small${f.fam === fm.id ? ' selected' : ''}" data-ffam="${fm.id}" style="--c:${famColor(fm.id)}"><i class="dot"></i>${esc(fm.label)}</button>`
  ).join('');
  const search = entries.length
    ? `<div class="search" id="search">
        <div class="search-row">
          <input type="search" id="q" placeholder="Buscar palabra, nota o pensamiento…" value="${esc(f.q)}" autocomplete="off" aria-label="Buscar en el diario" />
          <button type="button" class="icon-btn" id="qClear" aria-label="Quitar filtros" ${f.q || f.fam ? '' : 'hidden'}>${ICON_CLOSE}</button>
        </div>
        <div class="chips scroll-x" id="famFilter">${famChips}</div>
      </div>`
    : '';
  render(`${heroHTML()}${search}<div id="timeline"></div>`);

  const timeline = $('#timeline');
  const renderTimeline = () => {
    const list = filterEntries(entries, state.filter);
    const filtering = !!(state.filter.q.trim() || state.filter.fam);
    const groups = groupByDay(list);
    let html = '';
    if (!entries.length) html = emptyState();
    else if (!groups.length) html = `<div class="empty"><strong>Nada coincide</strong>Prueba con otra palabra o quita el filtro.</div>`;
    else {
      html = groups
        .map((g) => {
          const fams = [...new Set(g.entries.map(primaryOf))];
          const dots = fams.map((fid) => `<i style="--c:${famColor(fid)}"></i>`).join('');
          return `<section class="day-group"><div class="day-head"><h2>${esc(g.label)}</h2><span class="day-dots">${dots}</span></div>${g.entries.map(entryRow).join('')}</section>`;
        })
        .join('');
      if (filtering) html = `<div class="muted small" style="margin:14px 4px -8px">${list.length} ${list.length === 1 ? 'anotación' : 'anotaciones'}</div>${html}`;
    }
    timeline.innerHTML = html;
    hydrateThumbs(timeline);
    const clear = $('#qClear');
    if (clear) clear.hidden = !filtering;
  };
  renderTimeline();

  const box = $('#search');
  if (!box) return;
  let timer = null;
  $('#q', box).addEventListener('input', (ev) => {
    state.filter.q = ev.target.value;
    clearTimeout(timer);
    timer = setTimeout(renderTimeline, 140);
  });
  box.addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-ffam]');
    if (chip) {
      state.filter.fam = state.filter.fam === chip.dataset.ffam ? null : chip.dataset.ffam;
      $$('[data-ffam]', box).forEach((c) => c.classList.toggle('selected', c.dataset.ffam === state.filter.fam));
      renderTimeline();
      return;
    }
    if (ev.target.closest('#qClear')) {
      state.filter = { q: '', fam: null };
      $('#q', box).value = '';
      $$('[data-ffam]', box).forEach((c) => c.classList.remove('selected'));
      renderTimeline();
    }
  });
}

// ---------- editor ----------

async function viewEditor(id) {
  const entries = await getEntries();
  const existing = id ? entries.find((e) => e.id === id) : null;
  if (id && !existing) {
    toast('No encuentro esa anotación');
    location.replace('#/');
    return;
  }
  setChrome({ title: existing ? 'Editar' : 'Ahora mismo', back: true });
  setActiveTab('new');

  // Cada emoción lleva su propia intensidad. Las anotaciones antiguas solo tenían una global:
  // se reparte a todas al editar.
  const form = existing
    ? {
        ...existing,
        emotions: existing.emotions.map((x) => ({ ...x, intensity: emIntensity(existing, x) })),
      }
    : {
        id: null,
        createdAt: Date.now(),
        emotions: [],
        intensity: 5,
        note: '',
        thought: '',
        place: null,
        company: null,
        photoId: null,
      };
  let openFamily = null;
  const photos = []; // [{ id, full, thumb, url }] — id de una foto ya guardada, o null si es nueva
  const removedIds = [];
  let whenTouched = !!existing;
  const custom = loadCustomWords();
  // Palabras recientes: las últimas distintas que has usado, para anotar en dos toques.
  const recent = [];
  for (const e of entries) {
    for (const em of e.emotions || []) {
      if (em.word && !recent.some((r) => r.word === em.word)) recent.push({ word: em.word, family: em.family || 'otra' });
    }
    if (recent.length >= 8) break;
  }
  recent.length = Math.min(recent.length, 8);

  const placeChips = PLACES.map((p) => `<button type="button" class="chip small" data-place="${p.id}">${esc(p.label)}</button>`).join('');
  const companyChips = COMPANY.map((c) => `<button type="button" class="chip small" data-company="${c.id}">${esc(c.label)}</button>`).join('');

  render(
    `<div id="editor">
      <div class="card">
        <h2>¿Qué sientes?</h2>
        <p class="muted small">Toca una familia para desplegar sus palabras y marca las que encajen. Puedes mezclar varias, incluso contrarias.</p>
        <div id="recentBox"></div>
        <div class="tiles" id="famChips" style="margin-top:10px"></div>
        <div id="wordsBox"></div>
        <div class="chip-input">
          <input type="text" id="customWord" placeholder="Otra palabra que lo describa mejor…" maxlength="30" autocomplete="off" />
          <button type="button" class="btn btn-sm" id="addCustom">Añadir</button>
        </div>
      </div>

      <div class="card" id="chosenCard">
        <h2>¿Con cuánta fuerza?</h2>
        <p class="muted small" id="chosenHint" style="margin:2px 0 0"></p>
        <div id="chosen" style="margin-top:10px"></div>
      </div>

      <div class="card">
        <label class="field" style="margin-top:0"><span>¿Qué está pasando?</span><span class="hint">Dónde estás, qué haces, con quién. Lo justo para acordarte luego.</span><textarea id="note" rows="3">${esc(form.note || '')}</textarea></label>
        <label class="field"><span>¿Qué te pasa por la cabeza?</span><span class="hint">El pensamiento tal cual viene, sin corregirlo.</span><textarea id="thought" rows="3">${esc(form.thought || '')}</textarea></label>
      </div>

      <div class="card">
        <h3>Dónde</h3>
        <div class="chips" id="placeChips" style="margin-top:8px">${placeChips}</div>
        <h3 style="margin-top:14px">Con quién</h3>
        <div class="chips" id="companyChips" style="margin-top:8px">${companyChips}</div>
      </div>

      <div class="card">
        <h3>Fotos <span class="muted small" style="font-weight:400">(opcional, hasta ${MAX_PHOTOS})</span></h3>
        <div class="photo-box">
          <div class="photo-strip" id="photoStrip" hidden></div>
          <div class="muted small" id="photoHint" hidden style="margin:6px 0 2px">Toca una foto para verla entera. La estrella la pone de portada.</div>
          <div class="photo-actions">
            <button type="button" class="btn" id="btnCamera">Hacer foto</button>
            <button type="button" class="btn" id="btnGallery">De la galería</button>
          </div>
          <input type="file" accept="image/*" capture="environment" id="fileCamera" class="file-hidden" />
          <input type="file" accept="image/*" multiple id="fileGallery" class="file-hidden" />
        </div>
      </div>

      <div class="card">
        <div class="row between">
          <div><h3>Momento</h3><div class="muted small" id="whenText"></div></div>
          <button type="button" class="btn btn-sm" id="btnWhen">Cambiar</button>
        </div>
        <div id="whenEdit" hidden style="margin-top:10px"><input type="datetime-local" id="whenInput" /></div>
      </div>

      <div class="sticky-save"><button type="button" class="btn btn-primary btn-lg btn-block" id="btnSave">${existing ? 'Guardar cambios' : 'Guardar'}</button></div>
    </div>`,
    { sticky: true }
  );

  const root = $('#editor');
  const famBox = $('#famChips', root);
  const wordsBox = $('#wordsBox', root);
  const chosenBox = $('#chosen', root);
  const chosenHint = $('#chosenHint', root);
  const whenText = $('#whenText', root);
  const whenInput = $('#whenInput', root);
  const recentBox = $('#recentBox', root);
  const photoStrip = $('#photoStrip', root);
  const photoHint = $('#photoHint', root);

  function hasWord(word) {
    return form.emotions.some((x) => x.word === word);
  }

  function wordChip(w, famId, { dot = false } = {}) {
    const on = hasWord(w);
    return `<button type="button" class="chip small word ${on ? 'selected' : ''}" data-word="${esc(w)}" data-wfam="${famId}" style="--c:${famColor(famId)}" aria-pressed="${on}">${on ? ICON_CHECK : dot ? '<i class="dot"></i>' : ''}${esc(w)}</button>`;
  }

  /** Índice de la emoción más intensa (a igualdad, la elegida antes): es la principal. */
  function primaryIndex() {
    let best = -1;
    form.emotions.forEach((em, i) => {
      if (best < 0 || em.intensity > form.emotions[best].intensity) best = i;
    });
    return best;
  }

  /** Baldosas de familias; la abierta despliega sus palabras justo debajo de su fila. */
  function renderFamilies() {
    const html = [];
    FAMILIES.forEach((f, i) => {
      const chosen = form.emotions.filter((x) => x.family === f.id).map((x) => x.word);
      const open = openFamily === f.id;
      html.push(
        `<button type="button" class="tile${open ? ' open' : ''}${chosen.length ? ' has' : ''}" data-fam="${f.id}" style="--c:${famColor(f.id)}" aria-expanded="${open}">
          ${chosen.length ? `<span class="tile-count" aria-label="${chosen.length} elegidas">${chosen.length}</span>` : '<i class="dot"></i>'}
          <span class="tile-text"><span class="tile-name">${esc(f.label)}</span>${chosen.length ? `<span class="tile-sub">${esc(chosen.join(', '))}</span>` : ''}</span>
          <i class="chev">${ICON_CHEVRON}</i>
        </button>`
      );
      // Al final de cada fila de dos, si la familia abierta está en esa fila, su cajón de palabras.
      const rowEnd = i % 2 === 1 || i === FAMILIES.length - 1;
      if (rowEnd && openFamily) {
        const rowStart = i - (i % 2);
        const inRow = FAMILIES.slice(rowStart, i + 1).find((x) => x.id === openFamily);
        if (inRow) {
          html.push(
            `<div class="tile-drawer" style="--c:${famColor(inRow.id)}" role="group" aria-label="Palabras de ${esc(inRow.label)}">
              <div class="chips">${inRow.words.map((w) => wordChip(w, inRow.id)).join('')}</div>
              <div class="muted small" style="margin-top:8px">Marca las que encajen. Toca otra familia para añadir más.</div>
            </div>`
          );
        }
      }
    });
    famBox.innerHTML = html.join('');
  }

  function renderWords() {
    recentBox.innerHTML = recent.length
      ? `<div class="muted small" style="margin:10px 0 6px">Recientes</div><div class="chips">${recent
          .map((r) => wordChip(r.word, r.family, { dot: true }))
          .join('')}</div>`
      : '';
    wordsBox.innerHTML = custom.length
      ? `<div class="muted small" style="margin:12px 0 6px">Tus palabras</div><div class="chips">${custom
          .map((w) => wordChip(w, familyForWord(w).id))
          .join('')}</div>`
      : '';
  }

  /** Lista de emociones elegidas, cada una con su barra de intensidad. */
  function renderChosen() {
    if (!form.emotions.length) {
      chosenHint.textContent = 'Primero elige arriba lo que sientes. Aquí podrás decir cuánto, emoción por emoción.';
      chosenBox.innerHTML = '';
      return;
    }
    chosenHint.textContent =
      form.emotions.length > 1
        ? 'Toca la barra que corresponda a cada una. La más fuerte cuenta como principal en los patrones.'
        : 'Toca la barra que corresponda. Vuelve a tocar la última para bajar.';
    const pi = primaryIndex();
    chosenBox.innerHTML =
      form.emotions
        .map((em, idx) => {
          const v = em.intensity;
          const c = famColor(em.family);
          const segs = Array.from(
            { length: 10 },
            (_, i) =>
              `<button type="button" data-seg="${i + 1}" data-for="${idx}" class="${i < v ? 'on' : ''}" style="height:${22 + i * 2}px;--c:${c}" aria-label="${esc(em.word)}: ${i + 1} de 10" aria-pressed="${i < v}"></button>`
          ).join('');
          return `<div class="chosen-row" style="--c:${c}">
            <div class="chosen-head">
              <span class="tag"><i class="dot"></i>${esc(em.word)}</span>
              ${idx === pi && form.emotions.length > 1 ? '<span class="badge">principal</span>' : ''}
              <span class="chosen-val"><b>${v}</b> ${esc(intensityLabel(v))}</span>
              <button type="button" class="x" data-remove="${esc(em.word)}" aria-label="Quitar ${esc(em.word)}">${ICON_CLOSE}</button>
            </div>
            <div class="segs" role="group" aria-label="Intensidad de ${esc(em.word)}">${segs}</div>
          </div>`;
        })
        .join('') + '<div class="scale-hints"><span>nada</span><span>desbordante</span></div>';
  }

  function renderContext() {
    $$('[data-place]', root).forEach((c) => c.classList.toggle('selected', c.dataset.place === form.place));
    $$('[data-company]', root).forEach((c) => c.classList.toggle('selected', c.dataset.company === form.company));
  }

  function renderWhen() {
    whenText.textContent = whenTouched ? fmtFull(form.createdAt) : `Ahora, ${fmtTime(form.createdAt)}`;
  }

  function renderPhotos() {
    photoStrip.hidden = !photos.length;
    photoHint.hidden = !photos.length;
    photoStrip.innerHTML = photos
      .map(
        (p, i) => `<div class="photo-item${i === 0 ? ' cover' : ''}">
          <img src="${p.url}" alt="" data-photo-open="${i}" />
          ${i === 0 ? '<span class="cover-tag">Portada</span>' : `<button type="button" class="mini star" data-photo-cover="${i}" aria-label="Usar como portada">${ICON_STAR}</button>`}
          <button type="button" class="mini x" data-photo-remove="${i}" aria-label="Quitar foto">${ICON_CLOSE}</button>
        </div>`
      )
      .join('');
    const full = photos.length >= MAX_PHOTOS;
    $('#btnCamera', root).disabled = full;
    $('#btnGallery', root).disabled = full;
  }

  function addPhoto(p) {
    p.url = URL.createObjectURL(p.full);
    photos.push(p);
    renderPhotos();
  }

  function dropPhoto(i) {
    const [p] = photos.splice(i, 1);
    if (!p) return;
    if (p.url) URL.revokeObjectURL(p.url);
    if (p.id) removedIds.push(p.id);
    renderPhotos();
  }

  state.onLeave = () => {
    for (const p of photos) if (p.url) URL.revokeObjectURL(p.url);
  };

  function addWord(word, familyId) {
    const w = (word || '').trim().toLowerCase();
    if (!w) return;
    if (hasWord(w)) {
      form.emotions = form.emotions.filter((x) => x.word !== w);
    } else {
      // Una emoción nueva arranca con la intensidad de la última elegida (o 5), para no tener que empezar de cero.
      const last = form.emotions[form.emotions.length - 1];
      form.emotions.push({ word: w, family: familyId || familyForWord(w).id, intensity: last ? last.intensity : 5 });
      if (form.emotions.length === 1) toast('Ahora dile cuánto, más abajo', { ms: 1600 });
    }
    renderFamilies();
    renderWords();
    renderChosen();
  }

  function removeWord(word) {
    form.emotions = form.emotions.filter((x) => x.word !== word);
    renderFamilies();
    renderWords();
    renderChosen();
  }

  renderFamilies();
  renderWords();
  renderChosen();
  renderContext();
  renderWhen();

  if (existing) {
    // En orden, para que la portada siga siendo la misma.
    (async () => {
      for (const pid of photoIdsOf(existing)) {
        try {
          const p = await db.getPhoto(pid);
          if (p) addPhoto({ id: pid, full: p.full, thumb: p.thumb });
        } catch (e) {}
      }
    })();
  }

  root.addEventListener('click', (ev) => {
    const pic = ev.target.closest('[data-photo-open]');
    if (pic) {
      openLightbox(
        photos.map((p) => ({ url: p.url, blob: p.full })),
        Number(pic.dataset.photoOpen)
      );
      return;
    }
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.photoRemove != null) {
      dropPhoto(Number(t.dataset.photoRemove));
      return;
    }
    if (t.dataset.photoCover != null) {
      const [p] = photos.splice(Number(t.dataset.photoCover), 1);
      if (p) photos.unshift(p);
      renderPhotos();
      return;
    }
    if (t.dataset.fam) {
      openFamily = openFamily === t.dataset.fam ? null : t.dataset.fam;
      renderFamilies();
      return;
    }
    if (t.dataset.word) {
      addWord(t.dataset.word, t.dataset.wfam);
      return;
    }
    if (t.dataset.remove) {
      removeWord(t.dataset.remove);
      return;
    }
    if (t.dataset.place) {
      form.place = form.place === t.dataset.place ? null : t.dataset.place;
      renderContext();
      return;
    }
    if (t.dataset.company) {
      form.company = form.company === t.dataset.company ? null : t.dataset.company;
      renderContext();
      return;
    }
    if (t.dataset.seg) {
      const em = form.emotions[Number(t.dataset.for)];
      if (!em) return;
      const k = Number(t.dataset.seg);
      em.intensity = k === em.intensity ? k - 1 : k;
      renderChosen();
      return;
    }
    switch (t.id) {
      case 'addCustom': {
        const input = $('#customWord', root);
        addWord(input.value, null);
        input.value = '';
        break;
      }
      case 'btnCamera':
        $('#fileCamera', root).click();
        break;
      case 'btnGallery':
        $('#fileGallery', root).click();
        break;
      case 'btnWhen': {
        const box = $('#whenEdit', root);
        box.hidden = !box.hidden;
        if (!box.hidden) {
          whenInput.value = toLocalInputValue(form.createdAt);
          whenInput.focus();
        }
        break;
      }
      case 'btnSave':
        save(t);
        break;
      default:
        break;
    }
  });

  $('#customWord', root).addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      addWord(ev.target.value, null);
      ev.target.value = '';
    }
  });

  $('#note', root).addEventListener('input', (ev) => (form.note = ev.target.value));
  $('#thought', root).addEventListener('input', (ev) => (form.thought = ev.target.value));
  whenInput.addEventListener('change', () => {
    const ts = fromLocalInputValue(whenInput.value);
    if (ts) {
      form.createdAt = ts;
      whenTouched = true;
      renderWhen();
    }
  });

  async function onFile(ev) {
    const files = Array.from(ev.target.files || []);
    ev.target.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      toast(`Como mucho ${MAX_PHOTOS} fotos por anotación`);
      return;
    }
    if (files.length > room) toast(`Solo caben ${room} más; añado las primeras`);
    else toast(files.length > 1 ? 'Procesando fotos…' : 'Procesando foto…', { ms: 1200 });
    for (const file of files.slice(0, room)) {
      try {
        const p = await processPhoto(file);
        addPhoto({ id: null, full: p.full, thumb: p.thumb });
      } catch (e) {
        toast('No se pudo leer una foto');
      }
    }
  }
  $('#fileCamera', root).addEventListener('change', onFile);
  $('#fileGallery', root).addEventListener('change', onFile);

  async function save(btn) {
    if (!form.emotions.length) {
      toast('Ponle nombre al menos a una emoción');
      $('#famChips', root).scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!db.isUnlocked()) {
      showLock('El diario se bloqueó. Introduce el PIN para guardar.');
      return;
    }
    btn.disabled = true;
    try {
      // La más intensa va primero: es la "principal" que usan diario, patrones e informe.
      // El orden es estable, así que a igualdad gana la que se eligió antes.
      const emotions = form.emotions
        .map((x, i) => ({ word: x.word, family: x.family, intensity: Math.max(0, Math.min(10, Number(x.intensity) || 0)), i }))
        .sort((a, b) => b.intensity - a.intensity || a.i - b.i)
        .map(({ word, family, intensity }) => ({ word, family, intensity }));
      const entry = {
        id: form.id || db.uuid(),
        createdAt: form.createdAt,
        updatedAt: Date.now(),
        emotions,
        intensity: emotions[0].intensity,
        note: (form.note || '').trim(),
        thought: (form.thought || '').trim(),
        place: form.place || null,
        company: form.company || null,
        photoIds: [],
        photoId: null, // compatibilidad con versiones anteriores: la portada
      };
      for (const p of photos) {
        if (p.id) {
          entry.photoIds.push(p.id);
          continue;
        }
        const pid = db.uuid();
        await db.savePhoto(pid, p.full, p.thumb);
        entry.photoIds.push(pid);
      }
      for (const pid of removedIds) {
        await db.deletePhoto(pid);
        forgetThumb(pid);
      }
      entry.photoId = entry.photoIds[0] || null;
      await db.saveEntry(entry);
      upsertEntry(entry);
      for (const em of entry.emotions) if (em.family === OTHER_FAMILY.id) rememberCustomWord(em.word);
      try {
        if (!localStorage.getItem(PERSIST_KEY)) {
          db.requestPersistence();
          localStorage.setItem(PERSIST_KEY, '1');
        }
      } catch (e) {}
      toast(existing ? 'Cambios guardados' : 'Anotado');
      location.replace(existing ? `#/entry/${entry.id}` : '#/');
    } catch (e) {
      console.error(e);
      toast('No se pudo guardar: ' + (e.message || e));
      btn.disabled = false;
    }
  }
}

// ---------- detalle ----------

async function viewDetail(id) {
  const entries = await getEntries();
  const e = entries.find((x) => x.id === id);
  if (!e) {
    toast('No encuentro esa anotación');
    location.replace('#/');
    return;
  }
  setChrome({
    title: fmtShortDate(e.createdAt),
    back: true,
    actions: `<a class="icon-btn" href="#/edit/${esc(e.id)}" aria-label="Editar">${ICON_EDIT}</a>`,
  });
  setActiveTab('home');
  document.body.classList.add('immersive');
  state.onLeave = () => document.body.classList.remove('immersive');
  const i = Number(e.intensity) || 0;
  const primary = primaryOf(e);
  const ctx = [];
  if (e.place) ctx.push(['Dónde', labelFor(PLACES, e.place)]);
  if (e.company) ctx.push(['Con quién', labelFor(COMPANY, e.company)]);
  const key = skyFor(e.createdAt);
  const when = `${fmtDayLabel(e.createdAt)} · ${fmtTime(e.createdAt)}`;
  const caption = `<span class="shade"></span><span class="caption"><span class="when">${esc(when)}</span><span class="title">${esc(detailTitle(e))}</span></span>`;
  const pids = photoIdsOf(e);
  const header = pids.length
    ? `<div class="detail-hero has-photo"><img id="fullPhoto" alt="" /><button type="button" class="zoom-btn hero-zoom" id="zoomBtn" aria-label="Ampliar foto" hidden>${ICON_ZOOM}</button>${caption}</div>`
    : `<div class="detail-hero skyblock sky-${key}" style="${skyVars(key)}">${skyLayers(key)}${caption}</div>`;
  const strip =
    pids.length > 1
      ? `<div class="detail-strip" id="detailStrip">${pids
          .map((pid, k) => `<button type="button" data-open="${k}" aria-label="Foto ${k + 1} de ${pids.length}"><img data-photo="${esc(pid)}" alt="" /></button>`)
          .join('')}</div>`
      : '';
  // Anotación anterior y siguiente en el tiempo (la lista va de más nueva a más antigua).
  const pos = entries.indexOf(e);
  const newer = pos > 0 ? entries[pos - 1] : null;
  const older = pos < entries.length - 1 ? entries[pos + 1] : null;
  const navRow =
    newer || older
      ? `<div class="detail-nav">
          ${older ? `<button type="button" class="btn btn-ghost" data-go="${esc(older.id)}">‹ ${esc(fmtShortDate(older.createdAt))} ${esc(fmtTime(older.createdAt))}</button>` : '<span></span>'}
          ${newer ? `<button type="button" class="btn btn-ghost" data-go="${esc(newer.id)}">${esc(fmtShortDate(newer.createdAt))} ${esc(fmtTime(newer.createdAt))} ›</button>` : '<span></span>'}
        </div>`
      : '';
  const emotions = e.emotions || [];
  const emRows = emotions
    .map((em) => {
      const v = emIntensity(e, em);
      return `<div class="em-row" style="--c:${famColor(em.family || 'otra')}">
        <span class="name"><i class="dot"></i>${esc(em.word)}</span>
        <div class="meter-lg"><i style="width:${v * 10}%"></i></div>
        <span class="val"><b>${v}</b><small>${esc(intensityLabel(v))}</small></span>
      </div>`;
    })
    .join('');
  render(`<div id="detail">
    ${header}
    ${strip}
    <div class="card" style="margin-top:12px">
      <div class="muted small">${esc(fmtFull(e.createdAt))}</div>
      ${
        emotions.length > 1 && !hasMixedIntensity(e)
          ? `<div style="margin-top:8px">${emotionTags(emotions)}</div>
      <div class="intensity" style="margin-top:14px">
        <div><div class="meter-lg" style="--c:${famColor(primary)}"><i style="width:${i * 10}%"></i></div></div>
        <div><div class="value">${i}</div><div class="label">${esc(intensityLabel(i))}</div></div>
      </div>`
          : `<div class="em-list" style="margin-top:10px">${emRows}</div>`
      }
      ${ctx.length ? `<dl class="kv" style="margin:14px 0 0">${ctx.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    </div>
    ${e.note ? `<div class="card"><div class="section-title" style="margin-left:0">Qué estaba pasando</div><p class="quote">${esc(e.note)}</p></div>` : ''}
    ${e.thought ? `<div class="card"><div class="section-title" style="margin-left:0">Qué me pasaba por la cabeza</div><p class="quote">${esc(e.thought)}</p></div>` : ''}
    <div class="row" style="margin-top:16px;gap:8px">
      <a class="btn" href="#/edit/${esc(e.id)}" style="flex:1">Editar</a>
      <button type="button" class="btn btn-danger" id="delBtn" style="flex:1">Borrar</button>
    </div>
    ${navRow}
    ${newer || older ? '<p class="muted small" style="text-align:center;margin:10px 0 0">Desliza a los lados para pasar de anotación.</p>' : ''}
  </div>`);
  const detailEl = $('#detail');
  hydrateThumbs(detailEl);

  if (pids.length) {
    const items = []; // [{ url, blob }] en el orden de las fotos, para el visor
    (async () => {
      releaseFull();
      for (const pid of pids) {
        try {
          const p = await db.getPhoto(pid);
          if (!p || !location.hash.includes(e.id)) return;
          const url = URL.createObjectURL(p.full);
          state.fullURLs.push(url);
          items.push({ url, blob: p.full });
          if (items.length === 1) {
            const img = $('#fullPhoto');
            if (img) img.src = url;
            const zoom = $('#zoomBtn');
            if (zoom) zoom.hidden = false;
          }
        } catch (err) {}
      }
    })();
    // La foto del hero va recortada; tocarla (o el botón) la abre entera. La tira abre cada una.
    detailEl.addEventListener('click', (ev) => {
      if (!items.length) return;
      const t = ev.target.closest('[data-open]');
      if (t) openLightbox(items, Number(t.dataset.open));
      else if (ev.target.closest('#zoomBtn') || ev.target.closest('#fullPhoto')) openLightbox(items, 0);
    });
  }

  // Pasar a la anotación anterior o siguiente: botones o deslizar horizontalmente.
  const goTo = (id2) => location.replace(`#/entry/${id2}`);
  detailEl.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-go]');
    if (b) goTo(b.dataset.go);
  });
  if (newer || older) {
    let t0 = null;
    detailEl.addEventListener(
      'touchstart',
      (ev) => {
        const t = ev.touches[0];
        t0 = ev.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
      },
      { passive: true }
    );
    detailEl.addEventListener(
      'touchend',
      (ev) => {
        if (!t0) return;
        const t = ev.changedTouches[0];
        const dx = t.clientX - t0.x;
        const dy = t.clientY - t0.y;
        t0 = null;
        if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
        if (dx < 0 && newer) goTo(newer.id);
        else if (dx > 0 && older) goTo(older.id);
      },
      { passive: true }
    );
  }

  $('#delBtn').addEventListener('click', async () => {
    if (!confirm('¿Borrar esta anotación? No se puede deshacer.')) return;
    try {
      await db.deleteEntry(e);
      for (const pid of pids) forgetThumb(pid);
      removeEntry(e.id);
      toast('Borrada');
      location.replace('#/');
    } catch (err) {
      toast('No se pudo borrar');
    }
  });
}

// ---------- patrones ----------

async function viewPatterns() {
  setChrome({ title: 'Patrones' });
  setActiveTab('patterns');
  const all = await getEntries();
  const days = state.range;
  const list = filterLastDays(all, days);
  const s = summarize(list);
  const oldest = all.length ? all[all.length - 1].createdAt : Date.now();
  const spanDays = days || Math.ceil((Date.now() - oldest) / DAY_MS) + 1;
  const months = Math.max(1, Math.min(6, Math.ceil(spanDays / 30)));

  const tabs = [
    [7, '7 días'],
    [30, '30 días'],
    [90, '90 días'],
    [null, 'Todo'],
  ]
    .map(([d, l]) => `<button type="button" class="${d === days ? 'active' : ''}" data-range="${d === null ? '' : d}">${l}</button>`)
    .join('');

  const section = (title, inner) => `<div class="section"><div class="section-title">${title}</div><div class="card">${inner}</div></div>`;
  const weeks = days ? Math.ceil(days / 7) : Math.min(26, Math.ceil(spanDays / 7));
  const balance = weeks > 1 ? weeklyBalance(list, weeks) : [];

  render(`<div id="patterns">
    <div class="range-tabs">${tabs}</div>
    ${
      list.length
        ? `
      <div class="section"><div class="section-title">Resumen</div>${statsGrid(s)}</div>
      ${section('Calendario (emoción principal de cada día)', calendarChart(all, months))}
      ${
        balance.length
          ? section(
              'Balance por semanas',
              `${balanceChart(balance)}<p class="muted small" style="margin:12px 0 0">Agradables hacia arriba, desagradables hacia abajo. Una anotación cuenta como agradable si pesan más sus familias agradables (alegría, calma) que las desagradables.</p>`
            )
          : ''
      }
      ${section('Emociones (veces mencionadas)', familyList(s))}
      ${section('Palabras que más usas', wordsCloud(s.topWords))}
      ${section('Por día de la semana', stackedRows(s.byWeekday))}
      ${section('Por momento del día', stackedRows(s.byBand, { hint: true }))}
      ${s.byPlace.length ? section('Dónde', stackedRows(s.byPlace)) : ''}
      ${s.byCompany.length ? section('Con quién', stackedRows(s.byCompany)) : ''}
      <p class="muted small" style="margin-top:16px">Cada anotación cuenta una vez por su emoción principal (la más intensa; a igualdad, la que elegiste antes). Para llevar esto a consulta, genera un informe desde Ajustes.</p>`
        : `<div class="empty"><strong>Nada en este periodo</strong>${all.length ? 'Prueba con un rango más amplio.' : 'Cuando lleves unos días anotando, aquí empezarán a verse patrones.'}</div>`
    }
  </div>`);

  $('#patterns .range-tabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-range]');
    if (!b) return;
    state.range = b.dataset.range === '' ? null : Number(b.dataset.range);
    viewPatterns();
  });
}

// ---------- ajustes ----------

function pinFormHTML(mode) {
  const f = (id, label) =>
    `<input type="password" inputmode="numeric" pattern="[0-9]*" id="${id}" placeholder="${label}" minlength="4" maxlength="12" autocomplete="off" required />`;
  const title = mode === 'set' ? 'Activar PIN' : mode === 'change' ? 'Cambiar PIN' : 'Quitar PIN';
  return `<form id="pinForm" class="setting-actions" autocomplete="off">
    ${mode !== 'set' ? f('pinOld', 'PIN actual') : ''}
    ${mode !== 'remove' ? f('pinNew', 'Nuevo PIN (4 a 12 cifras)') + f('pinNew2', 'Repite el PIN') : ''}
    <div class="row" style="gap:8px"><button class="btn btn-primary" type="submit" style="flex:1">${title}</button><button class="btn btn-ghost" type="button" id="pinCancel">Cancelar</button></div>
    ${mode === 'set' ? '<p class="error small" style="margin:0">Si olvidas el PIN no hay forma de recuperar el diario. Guárdalo en un sitio seguro.</p>' : ''}
    <p class="error small" id="pinError" hidden></p>
  </form>`;
}

async function viewSettings() {
  setChrome({ title: 'Ajustes' });
  setActiveTab('settings');
  state.hasPin = await db.hasPin();
  const count = await db.countEntries();
  const est = await db.storageEstimate();
  let theme = 'system';
  try {
    theme = localStorage.getItem(THEME_KEY) || 'system';
  } catch (e) {}
  const standalone = isStandalone();
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  render(`<div id="settings">
    <div class="section"><div class="section-title">Seguridad</div><div class="card">
      <div class="setting"><div><strong>PIN de bloqueo</strong><div class="desc">${state.hasPin ? 'Activado. Se pide al abrir y tras dos minutos en segundo plano.' : 'Sin PIN. Cualquiera con tu móvil desbloqueado puede leer el diario.'}</div></div></div>
      <div class="setting-actions" id="pinActions">
        ${
          state.hasPin
            ? '<button type="button" class="btn" data-pin="change">Cambiar PIN</button><button type="button" class="btn" data-pin="remove">Quitar PIN</button><button type="button" class="btn btn-ghost" id="lockNow">Bloquear ahora</button>'
            : '<button type="button" class="btn btn-primary" data-pin="set">Activar PIN</button>'
        }
      </div>
      <div id="pinBox"></div>
    </div></div>

    <div class="section"><div class="section-title">Para consulta</div><div class="card">
      <div class="setting"><div><strong>Informe</strong><div class="desc">Resumen de un periodo con gráficos y anotaciones, para imprimir o compartir con tu psicólogo.</div></div></div>
      <a class="btn btn-primary btn-block" href="#/report">Generar informe</a>
    </div></div>

    <div class="section"><div class="section-title">Copia de seguridad</div><div class="card">
      <div class="setting"><div><strong>Tus datos viven solo en este móvil</strong><div class="desc">Si cambias de teléfono o borras el navegador, se pierden. Guarda una copia de vez en cuando.</div></div></div>
      <div class="setting-actions">
        <button type="button" class="btn" id="btnExport">Exportar copia (archivo JSON)</button>
        <button type="button" class="btn" id="btnImport">Importar copia</button>
        <input type="file" accept="application/json,.json" id="fileImport" class="file-hidden" />
      </div>
    </div></div>

    <div class="section"><div class="section-title">Aspecto</div><div class="card">
      <div class="setting"><div><strong>Tema</strong></div>
        <select id="themeSel" style="width:auto">
          <option value="system" ${theme === 'system' ? 'selected' : ''}>Como el sistema</option>
          <option value="light" ${theme === 'light' ? 'selected' : ''}>Claro</option>
          <option value="dark" ${theme === 'dark' ? 'selected' : ''}>Oscuro</option>
        </select>
      </div>
      <div class="setting"><div><strong>Colores</strong><div class="desc">El color de cada emoción y el color principal, por tema.</div></div><a class="btn btn-sm" href="#/colors">Personalizar</a></div>
      <div class="setting"><div><strong>Bienvenida</strong><div class="desc">Las tres pantallas del primer día.</div></div><button type="button" class="btn btn-sm" id="btnOnboard">Ver de nuevo</button></div>
    </div></div>

    ${
      standalone
        ? ''
        : `<div class="section"><div class="section-title">Instalar</div><div class="card">
      <div class="setting"><div><strong>Ponla en la pantalla de inicio</strong><div class="desc">Así se abre como una app y funciona sin conexión.</div></div></div>
      ${state.installPrompt ? '<button type="button" class="btn btn-primary btn-block" id="btnInstall">Instalar Momento</button>' : ''}
      <ol class="install-steps">
        ${
          isIOS
            ? '<li>En Safari, toca el botón de compartir (el cuadrado con la flecha).</li><li>Elige «Añadir a pantalla de inicio».</li>'
            : '<li>En Chrome, abre el menú (⋮).</li><li>Elige «Añadir a pantalla de inicio» o «Instalar aplicación».</li>'
        }
      </ol>
    </div></div>`
    }

    <div class="section"><div class="section-title">Datos</div><div class="card">
      <div class="setting"><div><strong>${count} ${count === 1 ? 'anotación' : 'anotaciones'}</strong><div class="desc">${est && est.usage ? `Ocupan ${formatBytes(est.usage)} en este dispositivo.` : ''} Todo se guarda cifrado en el propio móvil; nada sale de aquí salvo lo que tú exportes.</div></div></div>
      <div class="setting-actions"><button type="button" class="btn btn-danger" id="btnWipe">Borrar todo el diario</button></div>
    </div></div>

    <p class="muted small" style="text-align:center;margin-top:20px">Momento v${APP_VERSION}. Un diario para ponerle nombre a lo que sientes, en el momento.</p>
  </div>`);

  const root = $('#settings');

  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.pin) {
      $('#pinBox', root).innerHTML = pinFormHTML(b.dataset.pin);
      const form = $('#pinForm', root);
      const first = $('input', form);
      if (first) first.focus();
      form.addEventListener('submit', (e2) => onPinSubmit(e2, b.dataset.pin));
      return;
    }
    switch (b.id) {
      case 'pinCancel':
        $('#pinBox', root).innerHTML = '';
        break;
      case 'lockNow':
        db.lock();
        state.entries = null;
        clearThumbs();
        showLock();
        break;
      case 'btnExport':
        await exportBackup(b);
        break;
      case 'btnImport':
        $('#fileImport', root).click();
        break;
      case 'btnInstall':
        if (state.installPrompt) {
          state.installPrompt.prompt();
          state.installPrompt = null;
        }
        break;
      case 'btnOnboard':
        showOnboarding();
        break;
      case 'btnWipe':
        await wipeEverything();
        break;
      default:
        break;
    }
  });

  $('#themeSel', root).addEventListener('change', (ev) => {
    try {
      localStorage.setItem(THEME_KEY, ev.target.value);
    } catch (e) {}
    applyTheme();
  });

  $('#fileImport', root).addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (file) await importBackup(file);
  });

  async function onPinSubmit(ev, mode) {
    ev.preventDefault();
    const form = ev.target;
    const err = $('#pinError', form);
    const val = (id) => {
      const el = $('#' + id, form);
      return el ? el.value.trim() : '';
    };
    const oldPin = val('pinOld');
    const newPin = val('pinNew');
    const newPin2 = val('pinNew2');
    err.hidden = true;
    if (mode !== 'remove') {
      if (!/^\d{4,12}$/.test(newPin)) {
        err.textContent = 'El PIN debe tener entre 4 y 12 cifras.';
        err.hidden = false;
        return;
      }
      if (newPin !== newPin2) {
        err.textContent = 'Los dos PIN no coinciden.';
        err.hidden = false;
        return;
      }
    }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      if (mode === 'set') await db.setPin(newPin);
      else if (mode === 'change') await db.changePin(oldPin, newPin);
      else await db.removePin(oldPin);
      toast(mode === 'set' ? 'PIN activado' : mode === 'change' ? 'PIN cambiado' : 'PIN quitado');
      viewSettings();
    } catch (e) {
      err.textContent = e.message || 'No se pudo cambiar el PIN';
      err.hidden = false;
      btn.disabled = false;
    }
  }
}

async function exportBackup(btn) {
  btn.disabled = true;
  try {
    const entries = await getEntries();
    const out = { app: 'momento', version: 2, exportedAt: new Date().toISOString(), entries: [] };
    for (const e of entries) {
      const rec = { ...e };
      const pics = [];
      for (const pid of photoIdsOf(e)) {
        const p = await db.getPhoto(pid);
        if (p) pics.push({ id: pid, full: await blobToDataURL(p.full), thumb: await blobToDataURL(p.thumb) });
      }
      if (pics.length) rec.photos = pics;
      out.entries.push(rec);
    }
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const r = await shareOrDownload(blob, `momento-copia-${dayKey(Date.now())}.json`, 'Copia de Momento');
    if (r === 'downloaded') toast('Copia descargada');
    else if (r === 'shared') toast('Copia compartida');
  } catch (e) {
    console.error(e);
    toast('No se pudo exportar: ' + (e.message || e));
  } finally {
    btn.disabled = false;
  }
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    toast('El archivo no es una copia válida');
    return;
  }
  if (!data || data.app !== 'momento' || !Array.isArray(data.entries)) {
    toast('El archivo no es una copia de Momento');
    return;
  }
  const existing = await getEntries();
  const byId = new Map(existing.map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  try {
    for (const rec of data.entries) {
      if (!rec || !rec.id || !Array.isArray(rec.emotions) || !rec.createdAt) continue;
      const prev = byId.get(rec.id);
      if (prev && (prev.updatedAt || 0) >= (rec.updatedAt || 0)) continue;
      const entry = {
        id: rec.id,
        createdAt: Number(rec.createdAt),
        updatedAt: Number(rec.updatedAt) || Date.now(),
        emotions: rec.emotions
          .map((x) => {
            const em = { word: String(x.word || ''), family: familyOf(x.family).id };
            if (x.intensity != null && !Number.isNaN(Number(x.intensity))) em.intensity = Math.max(0, Math.min(10, Math.round(Number(x.intensity))));
            return em;
          })
          .filter((x) => x.word),
        intensity: Number(rec.intensity) || 0,
        note: String(rec.note || ''),
        thought: String(rec.thought || ''),
        place: rec.place || null,
        company: rec.company || null,
        photoIds: [],
        photoId: null,
      };
      // Copias nuevas traen `photos` (varias); las antiguas, una sola en `photo`.
      const pics = Array.isArray(rec.photos) ? rec.photos : rec.photo ? [{ id: rec.photoId, full: rec.photo, thumb: rec.photoThumb }] : [];
      for (const pic of pics) {
        if (!pic || typeof pic.full !== 'string') continue;
        const pid = pic.id || db.uuid();
        const full = await dataURLToBlob(pic.full);
        const thumb = pic.thumb ? await dataURLToBlob(pic.thumb) : full;
        await db.savePhoto(pid, full, thumb);
        forgetThumb(pid);
        entry.photoIds.push(pid);
      }
      entry.photoId = entry.photoIds[0] || null;
      await db.saveEntry(entry);
      upsertEntry(entry);
      if (prev) updated += 1;
      else added += 1;
    }
    toast(`Importadas ${added} nuevas y ${updated} actualizadas`);
    viewSettings();
  } catch (e) {
    console.error(e);
    toast('Error al importar: ' + (e.message || e));
  }
}

async function wipeEverything() {
  if (!confirm('¿Borrar TODO el diario de este dispositivo? No se puede deshacer.')) return;
  if (!confirm('Última comprobación: se borrarán todas las anotaciones y fotos. ¿Seguro?')) return;
  try {
    await db.wipeAll();
    try {
      localStorage.removeItem('momento.customWords');
      localStorage.removeItem(PERSIST_KEY);
    } catch (e) {}
    location.hash = '#/';
    location.reload();
  } catch (e) {
    toast('No se pudo borrar: ' + (e.message || e));
  }
}

// ---------- colores ----------

function currentThemeMode() {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced === 'dark' || forced === 'light') return forced;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

async function viewColors() {
  setChrome({ title: 'Colores', back: true });
  setActiveTab('settings');
  if (!state.colorsMode) state.colorsMode = currentThemeMode();
  const mode = state.colorsMode;
  document.documentElement.setAttribute('data-theme', mode);
  state.onLeave = () => {
    state.colorsMode = null;
    applyTheme();
  };
  const eff = effective(mode);
  const modeLabel = mode === 'dark' ? 'oscuro' : 'claro';

  const presetChips = PRESETS.map(
    (p) =>
      `<button type="button" class="preset ${isPresetActive(p.id) ? 'active' : ''}" data-preset="${p.id}"><span class="dots">${STACK_ORDER.map(
        (id) => `<i style="background:${p[mode].fam[id]}"></i>`
      ).join('')}</span><span>${esc(p.label)}</span></button>`
  ).join('');
  const famRows = FAMILIES.map(
    (f) =>
      `<label class="color-row"><span class="name"><i class="dot" style="--c:var(--fam-${f.id})"></i>${esc(f.label)}</span><code data-hex="${f.id}">${eff.fam[f.id]}</code><input type="color" data-fam="${f.id}" value="${eff.fam[f.id]}" aria-label="Color de ${esc(f.label)}" /></label>`
  ).join('');
  const previewTags = FAMILIES.slice(0, 4)
    .map((f) => `<span class="tag" style="--c:var(--fam-${f.id})"><i class="dot"></i>${esc(f.words[0])}</span>`)
    .join('');
  const previewBar = STACK_ORDER.map((id) => `<i style="--c:var(--fam-${id})"></i>`).join('');

  render(`<div id="colors">
    <div class="range-tabs">
      <button type="button" class="${mode === 'light' ? 'active' : ''}" data-mode="light">Tema claro</button>
      <button type="button" class="${mode === 'dark' ? 'active' : ''}" data-mode="dark">Tema oscuro</button>
    </div>
    <p class="muted small" style="margin:8px 4px 0">Estás editando el tema ${modeLabel}. Los cambios se guardan solos y se ven al momento.</p>

    <div class="section"><div class="section-title">Paletas</div><div class="card">
      <div class="chips">${presetChips}</div>
      <p class="muted small" style="margin:10px 0 0">Una paleta cambia los dos temas a la vez. Luego puedes retocar cualquier color.</p>
    </div></div>

    <div class="section"><div class="section-title">Emociones</div><div class="card"><div class="color-list">${famRows}</div></div></div>

    <div class="section"><div class="section-title">Color principal</div><div class="card">
      <label class="color-row" style="border-top:0"><span class="name"><i class="dot" style="--c:var(--accent)"></i>Botones y barra de intensidad</span><code data-hex="accent">${eff.accent}</code><input type="color" data-accent="1" value="${eff.accent}" aria-label="Color principal" /></label>
    </div></div>

    <div class="section"><div class="section-title">Legibilidad</div><div class="card" id="warnBox"></div></div>

    <div class="section"><div class="section-title">Vista previa</div><div class="card">
      <div class="tags">${previewTags}</div>
      <div class="preview-bar">${previewBar}</div>
      <div class="row preview-static" style="margin-top:12px;gap:8px" aria-hidden="true">
        <span class="btn btn-primary" style="flex:1">Botón principal</span>
        <span class="btn" style="flex:1">Botón normal</span>
      </div>
    </div></div>

    <div class="section stack">
      <button type="button" class="btn btn-block" id="resetMode">Restablecer el tema ${modeLabel}</button>
      <button type="button" class="btn btn-ghost btn-block" id="resetAll">Restablecer todos los colores</button>
    </div>
  </div>`);

  const root = $('#colors');

  function surfaceHex() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : mode === 'dark' ? '#1e2430' : '#ffffff';
  }

  function renderWarnings() {
    const w = checkPalette(effective(mode).fam, surfaceHex());
    $('#warnBox', root).innerHTML = w.length
      ? `<ul class="warn-list">${w.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
      : '<p class="muted" style="margin:0">Sin avisos: los colores se distinguen bien entre sí y sobre el fondo, también para daltonismo.</p>';
  }
  renderWarnings();

  root.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.fam) setFamilyColor(mode, t.dataset.fam, t.value);
    else if (t.dataset.accent) setAccent(mode, t.value);
    else return;
    applyColors();
    const code = $(`code[data-hex="${t.dataset.fam || 'accent'}"]`, root);
    if (code) code.textContent = t.value;
    $$('.preset', root).forEach((b) => b.classList.toggle('active', isPresetActive(b.dataset.preset)));
    renderWarnings();
  });

  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.mode) {
      state.colorsMode = b.dataset.mode;
      viewColors();
      return;
    }
    if (b.dataset.preset) {
      applyPreset(b.dataset.preset);
      applyColors();
      toast('Paleta aplicada a los dos temas');
      viewColors();
      return;
    }
    if (b.id === 'resetMode') {
      resetMode(mode);
      applyColors();
      viewColors();
      return;
    }
    if (b.id === 'resetAll') {
      resetAll();
      applyColors();
      toast('Colores restablecidos');
      viewColors();
    }
  });
}

// ---------- informe ----------

async function viewReport() {
  setChrome({ title: 'Informe', back: true });
  setActiveTab('settings');
  const all = await getEntries();
  const now = Date.now();
  const defFrom = now - 29 * DAY_MS;
  render(`<div id="report">
    <div class="card no-print">
      <div class="row" style="gap:8px;align-items:flex-end">
        <label class="field" style="flex:1;margin:0"><span>Desde</span><input type="date" id="rFrom" value="${dayKey(defFrom)}" /></label>
        <label class="field" style="flex:1;margin:0"><span>Hasta</span><input type="date" id="rTo" value="${dayKey(now)}" /></label>
      </div>
      <div class="chips" style="margin-top:12px">
        <label class="chip"><input type="checkbox" id="rPhotos" checked /> Fotos</label>
        <label class="chip"><input type="checkbox" id="rNotes" checked /> Qué pasaba</label>
        <label class="chip"><input type="checkbox" id="rThoughts" checked /> Pensamientos</label>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="rGen" style="margin-top:12px">Generar</button>
      <p class="muted small" style="margin:8px 0 0">Tú decides qué incluir. Lo que no marques no aparece en el informe.</p>
    </div>
    <div id="rOut"></div>
  </div>`);

  const root = $('#report');
  let lastBody = null;
  let lastRange = null;

  $('#rGen', root).addEventListener('click', async () => {
    const fromV = $('#rFrom', root).value;
    const toV = $('#rTo', root).value;
    if (!fromV || !toV) {
      toast('Elige las dos fechas');
      return;
    }
    const from = new Date(fromV + 'T00:00:00').getTime();
    const to = new Date(toV + 'T23:59:59.999').getTime();
    if (!(from <= to)) {
      toast('La fecha inicial es posterior a la final');
      return;
    }
    const btn = $('#rGen', root);
    btn.disabled = true;
    try {
      const { body, count } = await buildReport(all, {
        from,
        to,
        photos: $('#rPhotos', root).checked,
        notes: $('#rNotes', root).checked,
        thoughts: $('#rThoughts', root).checked,
      });
      lastBody = body;
      lastRange = { from, to };
      $('#rOut', root).innerHTML = `
        <div class="row no-print" style="gap:8px;margin:12px 0">
          <button type="button" class="btn" id="rPrint" style="flex:1">Imprimir / PDF</button>
          <button type="button" class="btn btn-primary" id="rShare" style="flex:1" ${count ? '' : 'disabled'}>Compartir</button>
        </div>
        <div class="card">${body}</div>`;
      $('#rPrint', root).addEventListener('click', () => window.print());
      $('#rShare', root).addEventListener('click', async () => {
        const html = standaloneHTML(lastBody, `Momento · informe ${fmtShortDate(lastRange.from)} a ${fmtShortDate(lastRange.to)}`, customReportCSS());
        const blob = new Blob([html], { type: 'text/html' });
        const r = await shareOrDownload(blob, `momento-informe-${dayKey(lastRange.from)}_${dayKey(lastRange.to)}.html`, 'Informe de Momento');
        if (r === 'downloaded') toast('Informe descargado. Ábrelo con el navegador.');
      });
    } catch (e) {
      console.error(e);
      toast('No se pudo generar: ' + (e.message || e));
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- bienvenida ----------

function onboardArt(n) {
  if (n === 0) {
    const dots = STACK_ORDER.map((id, i) => {
      const a = Math.PI * (1 - i / 7);
      const x = (120 + Math.cos(a) * 92).toFixed(1);
      const y = (118 - Math.sin(a) * 80).toFixed(1);
      return `<circle cx="${x}" cy="${y}" r="${i === 2 ? 16 : 11}" fill="${famColor(id)}"></circle>`;
    }).join('');
    return `<svg viewBox="0 0 240 170" width="240" height="170" aria-hidden="true">${dots}<line x1="28" y1="130" x2="212" y2="130" stroke="var(--line-strong)" stroke-width="3" stroke-linecap="round"></line><text x="120" y="160" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="22" font-weight="600" fill="var(--text)">nostalgia</text></svg>`;
  }
  if (n === 1) {
    return `<svg viewBox="0 0 240 170" width="240" height="170" aria-hidden="true"><circle cx="120" cy="85" r="64" fill="none" stroke="var(--line-strong)" stroke-width="3"></circle><line x1="120" y1="85" x2="120" y2="40" stroke="var(--text)" stroke-width="4" stroke-linecap="round"></line><line x1="120" y1="85" x2="152" y2="102" stroke="var(--text)" stroke-width="4" stroke-linecap="round"></line><circle cx="120" cy="85" r="5" fill="var(--text)"></circle><circle cx="196" cy="42" r="18" fill="var(--sun)"></circle><line x1="170" y1="66" x2="222" y2="66" stroke="var(--line-strong)" stroke-width="3" stroke-linecap="round"></line></svg>`;
  }
  const c = ['', 'tristeza', '', 'calma', 'miedo', '', 'tristeza', 'alegria', '', 'miedo', '', 'calma', 'calma', 'tristeza', '', 'cansancio', 'miedo', '', '', 'alegria', 'tristeza', 'calma', '', '', 'miedo', 'enfado', '', 'tristeza'];
  let s = '';
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 7; k++) {
      const f = c[r * 7 + k];
      s += `<rect x="${16 + k * 30}" y="${22 + r * 32}" width="24" height="24" rx="6" fill="${f ? famColor(f) : 'var(--surface-2)'}"></rect>`;
    }
  }
  return `<svg viewBox="0 0 240 170" width="240" height="170" aria-hidden="true">${s}</svg>`;
}

const ONBOARD = [
  {
    title: 'Ponle nombre a lo que sientes',
    text: 'Decir «estoy nervioso, un 7» ya lo baja un poco. Y con el tiempo distingues nervios de agobio, y tristeza de cansancio.',
  },
  {
    title: 'En el momento, no después',
    text: 'Lo que anotas en el bus no lo reescribe el humor de la consulta. Veinte segundos bastan, con foto o sin ella.',
  },
  {
    title: 'Lo que se repite, se ve',
    text: 'Domingos por la tarde, después de ver a alguien, en el trabajo. Los patrones salen solos; tú solo anotas. Y cuando quieras, un informe para consulta.',
  },
];

function maybeOnboard() {
  let seen = '1';
  try {
    seen = localStorage.getItem(ONBOARD_KEY) || '';
  } catch (e) {
    seen = '1';
  }
  if (!seen) showOnboarding();
}

function showOnboarding() {
  const el = $('#onboard');
  if (!el) return;
  let i = 0;
  const draw = () => {
    const o = ONBOARD[i];
    const last = i === ONBOARD.length - 1;
    el.innerHTML = `<div class="top"><button type="button" class="btn btn-ghost btn-sm" data-skip="1">Saltar</button></div>
      <main>${onboardArt(i)}<h1>${esc(o.title)}</h1><p>${esc(o.text)}</p></main>
      <div class="bottom"><div class="ob-dots">${ONBOARD.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div><button type="button" class="btn btn-primary btn-lg btn-block" data-next="1">${last ? 'Empezar' : 'Siguiente'}</button></div>`;
  };
  const finish = () => {
    el.hidden = true;
    el.innerHTML = '';
    el.onclick = null;
    try {
      localStorage.setItem(ONBOARD_KEY, '1');
    } catch (e) {}
  };
  el.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.skip) return finish();
    if (b.dataset.next) {
      if (i >= ONBOARD.length - 1) return finish();
      i += 1;
      draw();
    }
  };
  el.hidden = false;
  draw();
}

// ---------- arranque ----------

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
});

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (local && !location.search.includes('sw=1')) return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'activated' && navigator.serviceWorker.controller) {
            toast('Hay una versión nueva. Toca para recargar.', { ms: 8000, onClick: () => location.reload() });
          }
        });
      });
    })
    .catch((e) => console.warn('SW', e));
}

async function main() {
  applyTheme();
  applyColors();
  try {
    const st = await db.init();
    state.hasPin = st.hasPin;
    if (st.locked) showLock();
    else {
      await route();
      maybeOnboard();
    }
  } catch (e) {
    console.error(e);
    render(`<div class="empty"><strong>No se pudo iniciar</strong>${esc(e.message || String(e))}</div>`);
  }
  registerSW();
}

main();

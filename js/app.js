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
import { processPhoto, blobToDataURL, dataURLToBlob } from './photo.js';
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
import { summarize, filterLastDays } from './stats.js';
import { statsGrid, familyList, wordsCloud, stackedRows, calendarChart, famColor, emotionTags } from './charts.js';
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

const APP_VERSION = '1.0.0';
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
  fullURL: null,
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
  if (state.fullURL) URL.revokeObjectURL(state.fullURL);
  state.fullURL = null;
}

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

function entryRow(e) {
  const i = Number(e.intensity) || 0;
  const words = (e.emotions || [])
    .map((em) => `<span class="w" style="--c:${famColor(em.family || 'otra')}"><i class="dot"></i>${esc(em.word)}</span>`)
    .join('');
  const note = e.note ? `<div class="note">${esc(e.note)}</div>` : '';
  const thumb = e.photoId ? `<img class="thumb" data-photo="${esc(e.photoId)}" alt="" />` : '';
  return `<a class="entry${e.photoId ? ' has-thumb' : ''}" href="#/entry/${esc(e.id)}">
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

async function viewHome() {
  setChrome({ title: 'Momento' });
  setActiveTab('home');
  const entries = await getEntries();
  const groups = groupByDay(entries);
  const timeline = groups.length
    ? groups
        .map((g) => {
          const fams = [...new Set(g.entries.map(primaryOf))];
          const dots = fams.map((f) => `<i style="--c:${famColor(f)}"></i>`).join('');
          return `<section class="day-group"><div class="day-head"><h2>${esc(g.label)}</h2><span class="day-dots">${dots}</span></div>${g.entries.map(entryRow).join('')}</section>`;
        })
        .join('')
    : emptyState();
  render(`${heroHTML()}${timeline}`);
  hydrateThumbs(els.view);
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

  const form = existing
    ? { ...existing, emotions: existing.emotions.map((x) => ({ ...x })) }
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
  let activeFamily = form.emotions.length && form.emotions[0].family !== 'otra' ? form.emotions[0].family : null;
  let newPhoto = null;
  let removePhoto = false;
  let previewURL = null;
  let whenTouched = !!existing;
  const custom = loadCustomWords();

  const famChips = FAMILIES.map(
    (f) =>
      `<button type="button" class="tile" data-fam="${f.id}" style="--c:${famColor(f.id)}" aria-pressed="false"><i class="dot"></i><span>${esc(f.label)}</span><i class="check">${ICON_CHECK}</i></button>`
  ).join('');
  const placeChips = PLACES.map((p) => `<button type="button" class="chip small" data-place="${p.id}">${esc(p.label)}</button>`).join('');
  const companyChips = COMPANY.map((c) => `<button type="button" class="chip small" data-company="${c.id}">${esc(c.label)}</button>`).join('');

  render(
    `<div id="editor">
      <div class="card">
        <h2>¿Qué sientes?</h2>
        <p class="muted small">Toca una familia y afina la palabra. Puedes elegir varias; la primera cuenta como principal.</p>
        <div class="tags" id="selTags" style="margin:8px 0 12px"></div>
        <div class="tiles" id="famChips">${famChips}</div>
        <div id="wordsBox" style="margin-top:12px"></div>
        <div class="chip-input">
          <input type="text" id="customWord" placeholder="Otra palabra que lo describa mejor…" maxlength="30" autocomplete="off" />
          <button type="button" class="btn btn-sm" id="addCustom">Añadir</button>
        </div>
      </div>

      <div class="card">
        <h2>¿Con cuánta fuerza?</h2>
        <p class="muted small" style="margin:2px 0 0">Toca la barra que corresponda. Vuelve a tocar la última para bajar.</p>
        <div class="intensity" style="margin-top:10px">
          <div>
            <div class="segs" id="segs" role="group" aria-label="Intensidad de 0 a 10"></div>
            <div class="scale-hints"><span>nada</span><span>desbordante</span></div>
          </div>
          <div><div class="value" id="intVal">${Number(form.intensity) || 0}</div><div class="label" id="intLabel">${esc(intensityLabel(form.intensity))}</div></div>
        </div>
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
        <h3>Foto <span class="muted small" style="font-weight:400">(opcional)</span></h3>
        <div class="photo-box">
          <div class="photo-preview" id="photoPreview" hidden><img id="photoImg" alt="" /></div>
          <div class="photo-actions">
            <button type="button" class="btn" id="btnCamera">Hacer foto</button>
            <button type="button" class="btn" id="btnGallery">De la galería</button>
            <button type="button" class="btn btn-ghost" id="btnRemovePhoto" hidden>Quitar</button>
          </div>
          <input type="file" accept="image/*" capture="environment" id="fileCamera" class="file-hidden" />
          <input type="file" accept="image/*" id="fileGallery" class="file-hidden" />
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
  const selTags = $('#selTags', root);
  const wordsBox = $('#wordsBox', root);
  const whenText = $('#whenText', root);
  const whenInput = $('#whenInput', root);
  const photoPreview = $('#photoPreview', root);
  const photoImg = $('#photoImg', root);
  const btnRemovePhoto = $('#btnRemovePhoto', root);

  function hasWord(word) {
    return form.emotions.some((x) => x.word === word);
  }

  function renderTags() {
    selTags.innerHTML = form.emotions.length
      ? form.emotions
          .map(
            (em, idx) =>
              `<span class="tag" style="--c:${famColor(em.family)}"><i class="dot"></i>${esc(em.word)}${idx === 0 && form.emotions.length > 1 ? ' <span class="muted small">principal</span>' : ''}<button type="button" data-remove="${esc(em.word)}" aria-label="Quitar ${esc(em.word)}">×</button></span>`
          )
          .join('')
      : '<span class="muted small">Nada elegido todavía.</span>';
    renderSegs();
  }

  function renderFamilies() {
    $$('.tile', root).forEach((c) => {
      const on = c.dataset.fam === activeFamily;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function renderSegs() {
    const box = $('#segs', root);
    if (!box) return;
    const v = Math.max(0, Math.min(10, Number(form.intensity) || 0));
    const primary = form.emotions.length ? form.emotions[0].family : null;
    const c = primary ? famColor(primary) : 'var(--sun)';
    box.innerHTML = Array.from(
      { length: 10 },
      (_, i) =>
        `<button type="button" data-seg="${i + 1}" class="${i < v ? 'on' : ''}" style="height:${26 + i * 2}px;--c:${c}" aria-label="${i + 1} de 10" aria-pressed="${i < v}"></button>`
    ).join('');
    $('#intVal', root).textContent = String(v);
    $('#intLabel', root).textContent = intensityLabel(v);
  }

  function renderWords() {
    const parts = [];
    if (activeFamily) {
      const fam = familyOf(activeFamily);
      parts.push(
        `<div class="chips">${fam.words
          .map(
            (w) =>
              `<button type="button" class="chip small word ${hasWord(w) ? 'selected' : ''}" data-word="${esc(w)}" data-wfam="${fam.id}" style="--c:${famColor(fam.id)}">${esc(w)}</button>`
          )
          .join('')}</div>`
      );
    } else {
      parts.push('<p class="muted small" style="margin:0">Elige una familia arriba para ver palabras más precisas.</p>');
    }
    if (custom.length) {
      parts.push(
        `<div class="muted small" style="margin:10px 0 6px">Tus palabras</div><div class="chips">${custom
          .map((w) => {
            const fam = familyForWord(w);
            return `<button type="button" class="chip small word ${hasWord(w) ? 'selected' : ''}" data-word="${esc(w)}" data-wfam="${fam.id}" style="--c:${famColor(fam.id)}">${esc(w)}</button>`;
          })
          .join('')}</div>`
      );
    }
    wordsBox.innerHTML = parts.join('');
  }

  function renderContext() {
    $$('[data-place]', root).forEach((c) => c.classList.toggle('selected', c.dataset.place === form.place));
    $$('[data-company]', root).forEach((c) => c.classList.toggle('selected', c.dataset.company === form.company));
  }

  function renderWhen() {
    whenText.textContent = whenTouched ? fmtFull(form.createdAt) : `Ahora, ${fmtTime(form.createdAt)}`;
  }

  function setPreview(blob) {
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = blob ? URL.createObjectURL(blob) : null;
    photoPreview.hidden = !previewURL;
    btnRemovePhoto.hidden = !previewURL;
    if (previewURL) photoImg.src = previewURL;
  }

  function addWord(word, familyId) {
    const w = (word || '').trim().toLowerCase();
    if (!w) return;
    if (hasWord(w)) {
      form.emotions = form.emotions.filter((x) => x.word !== w);
    } else {
      form.emotions.push({ word: w, family: familyId || familyForWord(w).id });
    }
    renderTags();
    renderWords();
  }

  renderTags();
  renderFamilies();
  renderWords();
  renderContext();
  renderWhen();

  if (existing && existing.photoId) {
    db.getPhoto(existing.photoId)
      .then((p) => {
        if (p && !newPhoto && !removePhoto) setPreview(p.full);
      })
      .catch(() => {});
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    if (t.dataset.fam) {
      activeFamily = activeFamily === t.dataset.fam ? null : t.dataset.fam;
      renderFamilies();
      renderWords();
      return;
    }
    if (t.dataset.word) {
      addWord(t.dataset.word, t.dataset.wfam);
      return;
    }
    if (t.dataset.remove) {
      form.emotions = form.emotions.filter((x) => x.word !== t.dataset.remove);
      renderTags();
      renderWords();
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
      const k = Number(t.dataset.seg);
      form.intensity = k === (Number(form.intensity) || 0) ? k - 1 : k;
      renderSegs();
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
      case 'btnRemovePhoto':
        newPhoto = null;
        if (form.photoId) removePhoto = true;
        setPreview(null);
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
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      toast('Procesando foto…', { ms: 1200 });
      newPhoto = await processPhoto(file);
      removePhoto = false;
      setPreview(newPhoto.full);
    } catch (e) {
      toast('No se pudo leer la foto');
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
      const entry = {
        id: form.id || db.uuid(),
        createdAt: form.createdAt,
        updatedAt: Date.now(),
        emotions: form.emotions,
        intensity: Number(form.intensity) || 0,
        note: (form.note || '').trim(),
        thought: (form.thought || '').trim(),
        place: form.place || null,
        company: form.company || null,
        photoId: form.photoId || null,
      };
      if (newPhoto) {
        const pid = db.uuid();
        await db.savePhoto(pid, newPhoto.full, newPhoto.thumb);
        if (form.photoId) {
          await db.deletePhoto(form.photoId);
          forgetThumb(form.photoId);
        }
        entry.photoId = pid;
      } else if (removePhoto && form.photoId) {
        await db.deletePhoto(form.photoId);
        forgetThumb(form.photoId);
        entry.photoId = null;
      }
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
  const header = e.photoId
    ? `<div class="detail-hero"><img id="fullPhoto" alt="" />${caption}</div>`
    : `<div class="detail-hero skyblock sky-${key}" style="${skyVars(key)}">${skyLayers(key)}${caption}</div>`;
  render(`<div id="detail">
    ${header}
    <div class="card" style="margin-top:12px">
      <div class="muted small">${esc(fmtFull(e.createdAt))}</div>
      <div style="margin-top:8px">${emotionTags(e.emotions)}</div>
      <div class="intensity" style="margin-top:14px">
        <div><div class="meter-lg" style="--c:${famColor(primary)}"><i style="width:${i * 10}%"></i></div></div>
        <div><div class="value">${i}</div><div class="label">${esc(intensityLabel(i))}</div></div>
      </div>
      ${ctx.length ? `<dl class="kv" style="margin:14px 0 0">${ctx.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    </div>
    ${e.note ? `<div class="card"><div class="section-title" style="margin-left:0">Qué estaba pasando</div><p class="quote">${esc(e.note)}</p></div>` : ''}
    ${e.thought ? `<div class="card"><div class="section-title" style="margin-left:0">Qué me pasaba por la cabeza</div><p class="quote">${esc(e.thought)}</p></div>` : ''}
    <div class="row" style="margin-top:16px;gap:8px">
      <a class="btn" href="#/edit/${esc(e.id)}" style="flex:1">Editar</a>
      <button type="button" class="btn btn-danger" id="delBtn" style="flex:1">Borrar</button>
    </div>
  </div>`);

  if (e.photoId) {
    db.getPhoto(e.photoId)
      .then((p) => {
        if (!p) return;
        releaseFull();
        state.fullURL = URL.createObjectURL(p.full);
        const img = $('#fullPhoto');
        if (img) img.src = state.fullURL;
      })
      .catch(() => {});
  }

  $('#delBtn').addEventListener('click', async () => {
    if (!confirm('¿Borrar esta anotación? No se puede deshacer.')) return;
    try {
      await db.deleteEntry(e);
      if (e.photoId) forgetThumb(e.photoId);
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

  render(`<div id="patterns">
    <div class="range-tabs">${tabs}</div>
    ${
      list.length
        ? `
      <div class="section"><div class="section-title">Resumen</div>${statsGrid(s)}</div>
      ${section('Calendario (emoción principal de cada día)', calendarChart(all, months))}
      ${section('Emociones (veces mencionadas)', familyList(s))}
      ${section('Palabras que más usas', wordsCloud(s.topWords))}
      ${section('Por día de la semana', stackedRows(s.byWeekday))}
      ${section('Por momento del día', stackedRows(s.byBand, { hint: true }))}
      ${s.byPlace.length ? section('Dónde', stackedRows(s.byPlace)) : ''}
      ${s.byCompany.length ? section('Con quién', stackedRows(s.byCompany)) : ''}
      <p class="muted small" style="margin-top:16px">Cada anotación cuenta una vez por su emoción principal (la primera que eliges). Para llevar esto a consulta, genera un informe desde Ajustes.</p>`
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
    const out = { app: 'momento', version: 1, exportedAt: new Date().toISOString(), entries: [] };
    for (const e of entries) {
      const rec = { ...e };
      if (e.photoId) {
        const p = await db.getPhoto(e.photoId);
        if (p) {
          rec.photo = await blobToDataURL(p.full);
          rec.photoThumb = await blobToDataURL(p.thumb);
        }
      }
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
        emotions: rec.emotions.map((x) => ({ word: String(x.word || ''), family: familyOf(x.family).id })).filter((x) => x.word),
        intensity: Number(rec.intensity) || 0,
        note: String(rec.note || ''),
        thought: String(rec.thought || ''),
        place: rec.place || null,
        company: rec.company || null,
        photoId: null,
      };
      if (rec.photo) {
        const pid = rec.photoId || db.uuid();
        const full = await dataURLToBlob(rec.photo);
        const thumb = rec.photoThumb ? await dataURLToBlob(rec.photoThumb) : full;
        await db.savePhoto(pid, full, thumb);
        entry.photoId = pid;
        forgetThumb(pid);
      }
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

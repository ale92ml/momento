// colors.js — colores personalizables: familias emocionales y color principal, por tema.
// Se guardan solo las diferencias respecto a los valores por defecto (los de app.css).
// Incluye una comprobación de legibilidad (contraste, parecido entre vecinos y daltonismo).

import { STACK_ORDER, familyOf } from './emotions.js';

export const COLORS_KEY = 'momento.colors';

export const DEFAULTS = {
  light: {
    fam: { alegria: '#c98500', tristeza: '#2a78d6', calma: '#008300', enfado: '#e34948', miedo: '#4a3aa7', sorpresa: '#0f9bb1', cansancio: '#a8622a', rechazo: '#d55181' },
    accent: '#1f2633',
  },
  dark: {
    fam: { alegria: '#c98500', tristeza: '#3987e5', calma: '#008300', enfado: '#e66767', miedo: '#9085e9', sorpresa: '#22a5bc', cansancio: '#b8703d', rechazo: '#d55181' },
    accent: '#f2b33d',
  },
};

/** Paletas predefinidas. Todas validadas (contraste, daltonismo) en claro y oscuro. */
export const PRESETS = [
  { id: 'momento', label: 'Momento', light: DEFAULTS.light, dark: DEFAULTS.dark },
  {
    id: 'vivo',
    label: 'Vivo',
    light: { fam: { alegria: '#ad7200', rechazo: '#bb1562', tristeza: '#037df3', enfado: '#c21725', miedo: '#7667f1', cansancio: '#9f5100', sorpresa: '#0090a5', calma: '#008000' }, accent: DEFAULTS.light.accent },
    dark: { fam: { alegria: '#bd7d00', rechazo: '#db3d7c', tristeza: '#1f8aff', enfado: '#d02a3a', miedo: '#8871fd', cansancio: '#b15900', sorpresa: '#009db5', calma: '#008e00' }, accent: DEFAULTS.dark.accent },
  },
  {
    id: 'suave',
    label: 'Suave',
    light: { fam: { alegria: '#9e6700', rechazo: '#c76b88', tristeza: '#4176b9', enfado: '#cb6d67', miedo: '#6c69b8', cansancio: '#c3773d', sorpresa: '#0080a6', calma: '#4c8c48' }, accent: DEFAULTS.light.accent },
    dark: { fam: { alegria: '#ab7318', rechazo: '#cd718e', tristeza: '#4c82c6', enfado: '#d27270', miedo: '#7c74c4', cansancio: '#ca7c45', sorpresa: '#008db7', calma: '#64a55f' }, accent: DEFAULTS.dark.accent },
  },
  {
    id: 'contraste',
    label: 'Contraste',
    light: { fam: { alegria: '#ad7200', rechazo: '#bf3d6f', tristeza: '#0058b1', enfado: '#c43f3e', miedo: '#5345b5', cansancio: '#9f5100', sorpresa: '#0090a5', calma: '#248c20' }, accent: '#111111' },
    dark: { fam: { alegria: '#c58200', rechazo: '#c64475', tristeza: '#3f93f7', enfado: '#cb454a', miedo: '#8d7ef3', cansancio: '#ba5d00', sorpresa: '#00a4bc', calma: '#2c9228' }, accent: '#f5f5f5' },
  },
];

const MODES = ['light', 'dark'];

function norm(hex) {
  const h = String(hex || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(h) ? h : null;
}

export function loadColors() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(COLORS_KEY) || 'null');
  } catch (e) {}
  const out = { light: { fam: {}, accent: null }, dark: { fam: {}, accent: null } };
  for (const m of MODES) {
    const src = raw && raw[m] ? raw[m] : {};
    for (const [id, hex] of Object.entries(src.fam || {})) {
      const h = norm(hex);
      if (h && DEFAULTS[m].fam[id]) out[m].fam[id] = h;
    }
    out[m].accent = norm(src.accent);
  }
  return out;
}

export function saveColors(c) {
  try {
    localStorage.setItem(COLORS_KEY, JSON.stringify(c));
  } catch (e) {}
}

/** Colores efectivos de un tema: valores por defecto + personalizaciones. */
export function effective(mode) {
  const c = loadColors()[mode];
  return { fam: { ...DEFAULTS[mode].fam, ...c.fam }, accent: c.accent || DEFAULTS[mode].accent };
}

export function setFamilyColor(mode, id, hex) {
  const h = norm(hex);
  if (!h || !DEFAULTS[mode].fam[id]) return;
  const c = loadColors();
  if (h === DEFAULTS[mode].fam[id]) delete c[mode].fam[id];
  else c[mode].fam[id] = h;
  saveColors(c);
}

export function setAccent(mode, hex) {
  const h = norm(hex);
  if (!h) return;
  const c = loadColors();
  c[mode].accent = h === DEFAULTS[mode].accent ? null : h;
  saveColors(c);
}

export function resetMode(mode) {
  const c = loadColors();
  c[mode] = { fam: {}, accent: null };
  saveColors(c);
}

export function resetAll() {
  try {
    localStorage.removeItem(COLORS_KEY);
  } catch (e) {}
}

export function applyPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  const c = { light: { fam: {}, accent: null }, dark: { fam: {}, accent: null } };
  for (const m of MODES) {
    for (const [fid, hex] of Object.entries(p[m].fam)) if (hex !== DEFAULTS[m].fam[fid]) c[m].fam[fid] = hex;
    c[m].accent = p[m].accent && p[m].accent !== DEFAULTS[m].accent ? p[m].accent : null;
  }
  saveColors(c);
}

export function isPresetActive(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return false;
  for (const m of MODES) {
    const e = effective(m);
    for (const fid of Object.keys(DEFAULTS[m].fam)) if (e.fam[fid] !== p[m].fam[fid]) return false;
    if (e.accent !== (p[m].accent || DEFAULTS[m].accent)) return false;
  }
  return true;
}

// ---------- aplicar al documento ----------

function varsFor(mode) {
  const c = loadColors()[mode];
  let s = '';
  for (const [id, hex] of Object.entries(c.fam)) s += `--fam-${id}:${hex};`;
  if (c.accent) s += `--accent:${c.accent};--accent-text:${textOn(c.accent)};--sun:${c.accent};`;
  return s;
}

/** Inyecta (o actualiza) la hoja de estilos con los colores personalizados. */
export function applyColors() {
  const light = varsFor('light');
  const dark = varsFor('dark');
  let el = document.getElementById('customColors');
  if (!light && !dark) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = 'customColors';
    document.head.appendChild(el);
  }
  el.textContent =
    `:root{${light}}` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme='light']){${dark}}}` +
    `:root[data-theme='dark']{${dark}}`;
}

/** CSS para el informe independiente (siempre en claro). */
export function customReportCSS() {
  const light = varsFor('light');
  return light ? `:root{${light}}` : '';
}

// ---------- matemáticas de color ----------

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hexToLin(hex) {
  const h = norm(hex) || '#000000';
  return [1, 3, 5].map((i) => s2l(parseInt(h.slice(i, i + 2), 16) / 255));
}

function relLum([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(hexA, hexB) {
  const a = relLum(hexToLin(hexA));
  const b = relLum(hexToLin(hexB));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto negro o blanco según el fondo. */
export function textOn(hex) {
  return contrast(hex, '#ffffff') >= contrast(hex, '#14171c') ? '#ffffff' : '#14171c';
}

function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// Simulación de daltonismo (Machado, Oliveira y Fernandes 2009, severidad 1.0) en RGB lineal.
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

function simulate(lin, M) {
  const cl = (x) => Math.max(0, Math.min(1, x));
  return [0, 1, 2].map((i) => cl(M[i][0] * lin[0] + M[i][1] * lin[1] + M[i][2] * lin[2]));
}

function deltaE(hexA, hexB, kind) {
  const a = oklab(kind ? simulate(hexToLin(hexA), MACHADO[kind]) : hexToLin(hexA));
  const b = oklab(kind ? simulate(hexToLin(hexB), MACHADO[kind]) : hexToLin(hexB));
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function chroma(hex) {
  const [, a, b] = oklab(hexToLin(hex));
  return Math.hypot(a, b);
}

/**
 * Avisos de legibilidad para una paleta de familias sobre una superficie.
 * No bloquea nada: devuelve frases en castellano para mostrar.
 */
export function checkPalette(fam, surface) {
  const out = [];
  const name = (id) => familyOf(id).label;
  for (const id of STACK_ORDER) {
    const hex = fam[id];
    if (!hex) continue;
    if (contrast(hex, surface) < 3) out.push(`«${name(id)}» contrasta poco con el fondo; en los gráficos se verá débil.`);
    if (chroma(hex) < 0.1) out.push(`«${name(id)}» se ve casi gris; costará distinguirla de las demás.`);
  }
  for (let i = 0; i < STACK_ORDER.length - 1; i++) {
    const a = STACK_ORDER[i];
    const b = STACK_ORDER[i + 1];
    if (!fam[a] || !fam[b]) continue;
    if (deltaE(fam[a], fam[b]) < 15) {
      out.push(`«${name(a)}» y «${name(b)}» se parecen demasiado; en las barras apiladas se confundirán.`);
      continue;
    }
    const cvd = Math.min(deltaE(fam[a], fam[b], 'protan'), deltaE(fam[a], fam[b], 'deutan'));
    if (cvd < 6) out.push(`«${name(a)}» y «${name(b)}» se confunden para quien no distingue bien rojo y verde.`);
  }
  return out;
}

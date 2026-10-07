// stats.js — cálculos para la vista de patrones y el informe.

import { FAMILIES, OTHER_FAMILY, STACK_ORDER, PLACES, COMPANY } from './emotions.js';
import { dayKey } from './format.js';

const DAY_MS = 86400000;

export const WEEKDAYS = [
  { id: 1, label: 'Lunes' },
  { id: 2, label: 'Martes' },
  { id: 3, label: 'Miércoles' },
  { id: 4, label: 'Jueves' },
  { id: 5, label: 'Viernes' },
  { id: 6, label: 'Sábado' },
  { id: 0, label: 'Domingo' },
];

export const TIME_BANDS = [
  { id: 'manana', label: 'Mañana', hint: '6–12 h' },
  { id: 'mediodia', label: 'Mediodía', hint: '12–16 h' },
  { id: 'tarde', label: 'Tarde', hint: '16–21 h' },
  { id: 'noche', label: 'Noche', hint: '21–6 h' },
];

export function timeBand(ts) {
  const h = new Date(ts).getHours();
  if (h >= 6 && h < 12) return 'manana';
  if (h >= 12 && h < 16) return 'mediodia';
  if (h >= 16 && h < 21) return 'tarde';
  return 'noche';
}

/** Entradas dentro de los últimos `days` días (null = todas). */
export function filterLastDays(entries, days, now = Date.now()) {
  if (!days) return entries.slice();
  const from = now - days * DAY_MS;
  return entries.filter((e) => e.createdAt >= from);
}

export function filterRange(entries, fromTs, toTs) {
  return entries.filter((e) => e.createdAt >= fromTs && e.createdAt <= toTs);
}

/** La emoción principal es la primera que se eligió. */
export function primaryFamily(entry) {
  const em = (entry.emotions || [])[0];
  return em ? em.family || OTHER_FAMILY.id : OTHER_FAMILY.id;
}

/** Familias presentes en una entrada, sin repetir. */
export function entryFamilies(entry) {
  const set = new Set();
  for (const em of entry.emotions || []) set.add(em.family || OTHER_FAMILY.id);
  return [...set];
}

export const ALL_FAMILY_IDS = [...STACK_ORDER, OTHER_FAMILY.id];

function emptyFamilyCounts() {
  const o = {};
  for (const id of ALL_FAMILY_IDS) o[id] = 0;
  return o;
}

function makeBuckets(dims) {
  return dims.map((d) => ({ ...d, total: 0, byFamily: emptyFamilyCounts(), intensitySum: 0 }));
}

function addToBucket(bucket, entry) {
  bucket.total += 1;
  bucket.intensitySum += Number(entry.intensity) || 0;
  const f = primaryFamily(entry);
  bucket.byFamily[f] = (bucket.byFamily[f] || 0) + 1;
}

export function summarize(entries) {
  const count = entries.length;
  const familyCounts = emptyFamilyCounts();
  const familyIntensity = {};
  const wordCounts = new Map();
  const days = new Set();
  let intensitySum = 0;
  let negative = 0;
  let positive = 0;

  const byWeekday = makeBuckets(WEEKDAYS);
  const byBand = makeBuckets(TIME_BANDS);
  const byPlace = makeBuckets(PLACES);
  const byCompany = makeBuckets(COMPANY);

  for (const e of entries) {
    days.add(dayKey(e.createdAt));
    const inten = Number(e.intensity) || 0;
    intensitySum += inten;
    let val = 0;
    for (const f of entryFamilies(e)) {
      familyCounts[f] = (familyCounts[f] || 0) + 1;
      const fi = familyIntensity[f] || { sum: 0, n: 0 };
      fi.sum += inten;
      fi.n += 1;
      familyIntensity[f] = fi;
      const fam = FAMILIES.find((x) => x.id === f);
      if (fam) val += fam.valence;
    }
    if (val < 0) negative += 1;
    else if (val > 0) positive += 1;

    for (const em of e.emotions || []) {
      const key = (em.word || '').toLowerCase();
      if (!key) continue;
      const wc = wordCounts.get(key) || { word: em.word, family: em.family, count: 0 };
      wc.count += 1;
      wordCounts.set(key, wc);
    }

    const wd = byWeekday.find((b) => b.id === new Date(e.createdAt).getDay());
    if (wd) addToBucket(wd, e);
    const band = byBand.find((b) => b.id === timeBand(e.createdAt));
    if (band) addToBucket(band, e);
    if (e.place) {
      const p = byPlace.find((b) => b.id === e.place);
      if (p) addToBucket(p, e);
    }
    if (e.company) {
      const c = byCompany.find((b) => b.id === e.company);
      if (c) addToBucket(c, e);
    }
  }

  const topWords = [...wordCounts.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  const families = ALL_FAMILY_IDS.map((id) => ({
    id,
    count: familyCounts[id] || 0,
    avgIntensity: familyIntensity[id] ? familyIntensity[id].sum / familyIntensity[id].n : null,
  }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    count,
    days: days.size,
    avgIntensity: count ? intensitySum / count : null,
    negative,
    positive,
    families,
    topWords,
    byWeekday,
    byBand,
    byPlace: byPlace.filter((b) => b.total > 0),
    byCompany: byCompany.filter((b) => b.total > 0),
  };
}

/** Serie diaria (últimos `days` días, terminando hoy). */
export function dailySeries(entries, days, now = Date.now()) {
  const out = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    const ts = d.getTime();
    out.push({ ts, key: dayKey(ts), label: dayKey(ts), total: 0, byFamily: emptyFamilyCounts(), intensitySum: 0 });
  }
  const map = new Map(out.map((d) => [d.key, d]));
  for (const e of entries) {
    const d = map.get(dayKey(e.createdAt));
    if (d) addToBucket(d, e);
  }
  return out;
}

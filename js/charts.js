// charts.js — piezas de visualización compartidas por Patrones y el informe.
// Barras apiladas en HTML/CSS: color por familia (identidad), leyenda siempre
// presente con 2+ series, etiqueta directa con el total, y vista en tabla.

import { OTHER_FAMILY, STACK_ORDER, familyOf } from './emotions.js';
import { escapeHtml as esc, fmtShortDate, dayKey } from './format.js';
import { primaryFamily } from './stats.js';

export function famColor(id) {
  return `var(--fam-${id})`;
}

export function legend(ids) {
  if (!ids.length) return '';
  return `<div class="legend">${ids
    .map((id) => `<span><i class="dot" style="--c:${famColor(id)}"></i>${esc(familyOf(id).label)}</span>`)
    .join('')}</div>`;
}

/** Familias con algún dato en los buckets, en orden de apilado. */
export function presentFamilies(buckets) {
  const ids = [...STACK_ORDER, OTHER_FAMILY.id];
  return ids.filter((id) => buckets.some((b) => (b.byFamily[id] || 0) > 0));
}

function tableFor(buckets, ids) {
  if (!ids.length) return '';
  const head = ids.map((id) => `<th>${esc(familyOf(id).label)}</th>`).join('');
  const rows = buckets
    .map(
      (b) =>
        `<tr><th>${esc(b.label)}</th>${ids.map((id) => `<td>${b.byFamily[id] || ''}</td>`).join('')}<td>${b.total || ''}</td></tr>`
    )
    .join('');
  return `<details class="table-view"><summary>Ver como tabla</summary><table><thead><tr><th></th>${head}<th>Total</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

/** Filas con barra apilada por familia. */
export function stackedRows(buckets, { hint = false } = {}) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const ids = presentFamilies(buckets);
  const rows = buckets
    .map((b) => {
      const segs = ids
        .filter((id) => b.byFamily[id] > 0)
        .map((id) => {
          const n = b.byFamily[id];
          const pct = ((n / max) * 100).toFixed(2);
          return `<i class="seg" style="--c:${famColor(id)};flex:0 1 ${pct}%" title="${esc(familyOf(id).label)}: ${n}"></i>`;
        })
        .join('');
      const h = hint && b.hint ? `<small>${esc(b.hint)}</small>` : '';
      return `<div class="bar-row"><div class="lbl">${esc(b.label)}${h}</div><div class="bar">${segs}</div><div class="val">${b.total || ''}</div></div>`;
    })
    .join('');
  return `<div class="bars">${rows}</div>${legend(ids)}${tableFor(buckets, ids)}`;
}

const WD_INITIAL = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/** Columnas diarias apiladas por familia. */
export function dailyChart(series) {
  const max = Math.max(1, ...series.map((d) => d.total));
  const ids = presentFamilies(series);
  const cols = series
    .map((d) => {
      const segs = ids
        .filter((id) => d.byFamily[id] > 0)
        .map((id) => {
          const n = d.byFamily[id];
          const pct = ((n / max) * 100).toFixed(1);
          return `<i class="seg" style="--c:${famColor(id)};flex:0 1 ${pct}%" title="${esc(fmtShortDate(d.ts))} · ${esc(familyOf(id).label)}: ${n}"></i>`;
        })
        .join('');
      return `<div class="col" title="${esc(fmtShortDate(d.ts))}: ${d.total}">${segs}</div>`;
    })
    .join('');
  const n = series.length;
  const labels =
    n <= 14
      ? series.map((d) => `<span>${WD_INITIAL[new Date(d.ts).getDay()]}</span>`).join('')
      : `<span style="text-align:left">${esc(fmtShortDate(series[0].ts))}</span><span style="text-align:right">hoy</span>`;
  const gap = n > 31 ? 'gap:1px' : '';
  const tableRows = series.map((d) => ({ ...d, label: fmtShortDate(d.ts) })).filter((d) => d.total > 0);
  return `<div class="daily" style="${gap}">${cols}</div><div class="daily-labels" style="${gap}">${labels}</div>${legend(ids)}${tableFor(tableRows, ids)}`;
}

const WD_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const monthFmt = new Intl.DateTimeFormat('es-ES', { month: 'long' });
const monthYearFmt = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });

/** Calendario mensual coloreado por la emoción principal de cada día (últimos `monthsBack` meses). */
export function calendarChart(entries, monthsBack = 1, now = Date.now()) {
  const byDay = new Map();
  for (const e of entries) {
    const k = dayKey(e.createdAt);
    const fam = primaryFamily(e);
    const m = byDay.get(k) || { counts: {}, total: 0, lastTs: 0, lastFam: fam };
    m.counts[fam] = (m.counts[fam] || 0) + 1;
    m.total += 1;
    if (e.createdAt >= m.lastTs) {
      m.lastTs = e.createdAt;
      m.lastFam = fam;
    }
    byDay.set(k, m);
  }
  const dominant = (m) => {
    let best = null;
    let max = 0;
    for (const [f, n] of Object.entries(m.counts)) if (n > max) [best, max] = [f, n];
    return m.counts[m.lastFam] === max ? m.lastFam : best;
  };
  const today = new Date(now);
  const todayKey = dayKey(now);
  const present = new Set();
  const tableRows = [];
  const blocks = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const first = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = first.getFullYear();
    const mo = first.getMonth();
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const cells = [];
    let count = 0;
    for (let k = 0; k < offset; k++) cells.push('<span></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const key = dayKey(new Date(y, mo, d).getTime());
      const m = byDay.get(key);
      const cls = [];
      if (key === todayKey) cls.push('today');
      if (m) {
        const fam = dominant(m);
        present.add(fam);
        count += m.total;
        tableRows.push([`${d} ${monthFmt.format(first)}`, familyOf(fam).label, m.total]);
        cells.push(`<span class="d has ${cls.join(' ')}" style="--c:${famColor(fam)}" title="${d}: ${esc(familyOf(fam).label)} (${m.total})">${d}<i></i></span>`);
      } else {
        if (key > todayKey) cls.push('future');
        cells.push(`<span class="d ${cls.join(' ')}">${d}</span>`);
      }
    }
    const name = (y === today.getFullYear() && monthsBack === 1 ? monthFmt : monthYearFmt).format(first);
    blocks.push(
      `<div class="cal-head"><span class="cal-month">${esc(name.charAt(0).toUpperCase() + name.slice(1))}</span><span class="small muted">${count} ${count === 1 ? 'anotación' : 'anotaciones'}</span></div><div class="cal">${WD_SHORT.map((w) => `<span class="wd">${w}</span>`).join('')}${cells.join('')}</div>`
    );
  }
  const ids = [...STACK_ORDER, OTHER_FAMILY.id].filter((id) => present.has(id));
  const table = tableRows.length
    ? `<details class="table-view"><summary>Ver como tabla</summary><table><thead><tr><th>Día</th><th>Emoción principal</th><th>Anotaciones</th></tr></thead><tbody>${tableRows
        .map(([d, f, n]) => `<tr><th>${esc(d)}</th><td>${esc(f)}</td><td>${n}</td></tr>`)
        .join('')}</tbody></table></details>`
    : '';
  return `${blocks.join('')}${legend(ids)}${table}`;
}

/** Lista de familias con barra de frecuencia e intensidad media. */
export function familyList(summary) {
  if (!summary.families.length) return '<p class="muted">Sin datos.</p>';
  const max = Math.max(1, ...summary.families.map((f) => f.count));
  return `<div class="fam-list">${summary.families
    .map((f) => {
      const veces = f.count === 1 ? 'vez' : 'veces';
      const media = f.avgIntensity == null ? '' : `<small>intensidad media ${f.avgIntensity.toFixed(1).replace('.', ',')}</small>`;
      return `<div class="fam-row" style="--c:${famColor(f.id)}"><span class="name"><i class="dot"></i>${esc(familyOf(f.id).label)}</span><span class="meta"><b>${f.count} ${veces}</b>${media}</span><div class="track"><i style="width:${((f.count / max) * 100).toFixed(1)}%"></i></div></div>`;
    })
    .join('')}</div>`;
}

export function wordsCloud(topWords) {
  if (!topWords.length) return '<p class="muted">Sin datos.</p>';
  return `<div class="words-cloud">${topWords
    .map((w) => `<span class="tag" style="--c:${famColor(w.family || 'otra')}"><i class="dot"></i>${esc(w.word)}<b>${w.count}</b></span>`)
    .join('')}</div>`;
}

export function statsGrid(s) {
  const avg = s.avgIntensity == null ? '–' : s.avgIntensity.toFixed(1).replace('.', ',');
  return `<div class="stats-grid">
    <div class="stat"><div class="n">${s.count}</div><div class="l">anotaciones</div></div>
    <div class="stat"><div class="n">${s.days}</div><div class="l">días con registro</div></div>
    <div class="stat"><div class="n">${avg}</div><div class="l">intensidad media</div></div>
  </div>`;
}

export function emotionTags(emotions) {
  return `<div class="tags">${(emotions || [])
    .map((em) => `<span class="tag" style="--c:${famColor(em.family || 'otra')}"><i class="dot"></i>${esc(em.word)}</span>`)
    .join('')}</div>`;
}

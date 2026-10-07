// report.js — informe para llevar a consulta (en la app, imprimible o como HTML compartible).

import * as db from './db.js';
import { PLACES, COMPANY, labelFor, intensityLabel } from './emotions.js';
import { fmtFull, fmtShortDate, escapeHtml as esc } from './format.js';
import { summarize, filterRange } from './stats.js';
import { statsGrid, familyList, wordsCloud, stackedRows, emotionTags } from './charts.js';
import { blobToDataURL } from './photo.js';

export async function buildReport(entries, { from, to, photos = true, thoughts = true, notes = true }) {
  const list = filterRange(entries, from, to)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);
  const s = summarize(list);

  const thumbs = new Map();
  if (photos) {
    for (const e of list) {
      if (!e.photoId) continue;
      try {
        const b = await db.getThumb(e.photoId);
        if (b) thumbs.set(e.photoId, await blobToDataURL(b));
      } catch (err) {
        console.warn('foto no disponible', e.photoId);
      }
    }
  }

  const section = (title, inner) => `<section class="section"><div class="section-title">${title}</div>${inner}</section>`;

  const items = list
    .map((e) => {
      const ctx = [
        `Intensidad ${Number(e.intensity) || 0}/10 (${intensityLabel(e.intensity)})`,
        e.place ? labelFor(PLACES, e.place) : '',
        e.company ? labelFor(COMPANY, e.company) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const note = notes && e.note ? `<div class="txt"><label>Qué estaba pasando</label>${esc(e.note)}</div>` : '';
      const thought = thoughts && e.thought ? `<div class="txt"><label>Qué me pasaba por la cabeza</label>${esc(e.thought)}</div>` : '';
      const img = thumbs.has(e.photoId) ? `<img src="${thumbs.get(e.photoId)}" alt="" loading="lazy" />` : '';
      return `<article class="report-entry"><div class="when">${esc(fmtFull(e.createdAt))}</div>${emotionTags(e.emotions)}<div class="ctx">${esc(ctx)}</div>${note}${thought}${img}</article>`;
    })
    .join('');

  const body = `
    <div class="report-head">
      <div>
        <h2>Diario emocional</h2>
        <div class="muted small">Del ${esc(fmtShortDate(from))} al ${esc(fmtShortDate(to))} · generado el ${esc(fmtShortDate(Date.now()))}</div>
      </div>
    </div>
    ${list.length ? '' : '<p class="muted">No hay anotaciones en este periodo.</p>'}
    ${list.length ? section('Resumen', statsGrid(s)) : ''}
    ${list.length ? section('Emociones (veces mencionadas)', familyList(s)) : ''}
    ${list.length ? section('Palabras más usadas', wordsCloud(s.topWords)) : ''}
    ${list.length ? section('Por día de la semana (emoción principal)', stackedRows(s.byWeekday)) : ''}
    ${list.length ? section('Por momento del día', stackedRows(s.byBand, { hint: true })) : ''}
    ${s.byPlace.length ? section('Dónde', stackedRows(s.byPlace)) : ''}
    ${s.byCompany.length ? section('Con quién', stackedRows(s.byCompany)) : ''}
    ${list.length ? section(`Anotaciones (${list.length})`, `<div class="report-list">${items}</div>`) : ''}
  `;
  return { body, count: list.length };
}

const REPORT_CSS = `
:root{--bg:#fff;--surface:#fff;--surface-2:#ede9e1;--text:#1d1f24;--text-2:#4f525b;--muted:#6f727b;--line:#e4dfd5;--sun:#c98500;
--fam-alegria:#c98500;--fam-tristeza:#2a78d6;--fam-calma:#008300;--fam-enfado:#e34948;--fam-miedo:#4a3aa7;--fam-sorpresa:#0f9bb1;--fam-cansancio:#a8622a;--fam-rechazo:#d55181;--fam-otra:#898781}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.report{max-width:720px;margin:0 auto;padding:24px 20px}
h2{margin:0;font-size:1.4rem}.muted{color:var(--muted)}.small{font-size:.875rem}
.section{margin-top:22px}.section-title{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px;font-weight:700}
.stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.stat{border:1px solid var(--line);border-radius:10px;padding:10px 12px}.stat .n{font-size:1.5rem;font-weight:700;line-height:1.1}.stat .l{color:var(--muted);font-size:.75rem}
.fam-list{display:grid;gap:8px}.fam-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}.fam-row .track{grid-column:1/-1;height:10px;border-radius:3px;background:var(--surface-2);overflow:hidden}.fam-row .track i{display:block;height:100%;background:var(--c);border-radius:3px}
.fam-row .name{display:inline-flex;align-items:center;gap:8px;font-weight:600}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--c)}.fam-row .meta{text-align:right;line-height:1.15;white-space:nowrap}.fam-row .meta b{display:block;font-weight:600;font-size:.9rem}.fam-row .meta small{color:var(--muted);font-size:.72rem}
.tags,.words-cloud{display:flex;flex-wrap:wrap;gap:6px}.tag{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 8px;border-radius:999px;background:color-mix(in srgb,var(--c) 16%,#fff);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);font-size:.9rem}.tag b{margin-left:2px}
.bars{display:grid;gap:8px}.bar-row{display:grid;grid-template-columns:84px 1fr auto;align-items:center;gap:10px;font-size:.9rem}.bar-row .lbl{color:var(--text-2)}.bar-row .lbl small{display:block;color:var(--muted);font-size:.72rem}.bar-row .val{color:var(--text-2);min-width:2ch;text-align:right}
.bar{display:flex;gap:2px;height:14px}.bar .seg{height:100%;background:var(--c);border-radius:2px;min-width:2px}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:.82rem;color:var(--text-2)}.legend span{display:inline-flex;align-items:center;gap:6px}
.table-view summary{color:var(--muted);font-size:.8rem;cursor:pointer;margin-top:8px}.table-view table{border-collapse:collapse;width:100%;font-size:.8rem;margin-top:6px}.table-view th,.table-view td{text-align:right;padding:3px 6px;border-bottom:1px solid var(--line)}.table-view th:first-child,.table-view td:first-child{text-align:left}
.report-entry{padding:12px 0;border-top:1px solid var(--line);display:grid;gap:6px;break-inside:avoid;page-break-inside:avoid}.report-entry:first-child{border-top:0}.report-entry .when{font-weight:700}.report-entry .ctx{color:var(--muted);font-size:.85rem}
.report-entry .txt{white-space:pre-wrap}.report-entry .txt label{display:block;color:var(--muted);font-size:.8rem}.report-entry img{display:block;max-width:320px;max-height:240px;width:100%;object-fit:cover;border-radius:10px}
@media print{.report{padding:0}}
`;

export function standaloneHTML(body, title = 'Momento · informe', extraCSS = '') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${REPORT_CSS}${extraCSS}</style></head><body><main class="report">${body}</main></body></html>`;
}

/** Comparte un archivo con la hoja nativa si se puede; si no, lo descarga. */
export async function shareOrDownload(blob, filename, title = 'Momento') {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);
  return 'downloaded';
}

// format.js — fechas, horas y agrupaciones para la interfaz.

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayKey(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const fmtTimeObj = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const fmtLongObj = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
const fmtLongYearObj = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
const fmtShortObj = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtFullObj = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function fmtTime(ts) {
  return fmtTimeObj.format(new Date(ts));
}

export function fmtDayLabel(ts, now = Date.now()) {
  const today = startOfDay(now);
  const day = startOfDay(ts);
  if (day === today) return 'Hoy';
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (day === y.getTime()) return 'Ayer';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const s = (sameYear ? fmtLongObj : fmtLongYearObj).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtShortDate(ts) {
  return fmtShortObj.format(new Date(ts));
}

export function fmtFull(ts) {
  const s = fmtFullObj.format(new Date(ts));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Agrupa entradas (ya ordenadas desc) por día. */
export function groupByDay(entries, now = Date.now()) {
  const groups = [];
  let current = null;
  for (const e of entries) {
    const key = dayKey(e.createdAt);
    if (!current || current.key !== key) {
      current = { key, label: fmtDayLabel(e.createdAt, now), entries: [] };
      groups.push(current);
    }
    current.entries.push(e);
  }
  return groups;
}

/** Valor para un input datetime-local en hora local. */
export function toLocalInputValue(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInputValue(v) {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

export function toDateInputValue(ts) {
  return dayKey(ts);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

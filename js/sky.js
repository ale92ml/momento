// sky.js — cielo según la hora: portada del diario y cabecera del detalle sin foto.

export const SKIES = {
  amanecer: {
    name: 'Amanecer',
    bg: 'linear-gradient(180deg, #F9D5B8 0%, #F3C3C6 55%, #D9D0F0 100%)',
    sun: '#F5B15C',
    text: '#2B2430',
    sub: 'rgba(43,36,48,0.78)',
    horizon: 'rgba(43,36,48,0.35)',
    land: '#E7CFCB',
  },
  dia: {
    name: 'Día',
    bg: 'linear-gradient(180deg, #BFE0F7 0%, #E4F1FA 100%)',
    sun: '#F2C744',
    text: '#1D2A38',
    sub: 'rgba(29,42,56,0.78)',
    horizon: 'rgba(29,42,56,0.30)',
    land: '#D3E6F2',
  },
  atardecer: {
    name: 'Atardecer',
    bg: 'linear-gradient(180deg, #F4A85A 0%, #DA6C8C 55%, #5A4A8C 100%)',
    sun: '#FFD27A',
    text: '#2B1F33',
    sub: 'rgba(43,31,51,0.82)',
    horizon: 'rgba(255,255,255,0.55)',
    land: '#3E355F',
  },
  noche: {
    name: 'Noche',
    bg: 'linear-gradient(180deg, #1B2340 0%, #0F1526 100%)',
    sun: '#E9EDF2',
    text: '#FFFFFF',
    sub: 'rgba(255,255,255,0.78)',
    horizon: 'rgba(255,255,255,0.35)',
    land: '#0B101C',
    moon: true,
  },
};

/** Franja de cielo para una hora. */
export function skyFor(ts) {
  const h = new Date(ts).getHours();
  if (h >= 6 && h < 10) return 'amanecer';
  if (h >= 10 && h < 17) return 'dia';
  if (h >= 17 && h < 21) return 'atardecer';
  return 'noche';
}

export function greetingFor(ts) {
  const h = new Date(ts).getHours();
  if (h >= 6 && h < 13) return 'Buenos días';
  if (h >= 13 && h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

/** Variables CSS inline para un cielo. */
export function skyVars(key) {
  const s = SKIES[key] || SKIES.dia;
  return `--sky-bg:${s.bg};--sky-sun:${s.sun};--sky-text:${s.text};--sky-sub:${s.sub};--sky-horizon:${s.horizon};--sky-land:${s.land};`;
}

/** Capas del cielo (tierra, sol o luna, horizonte). */
export function skyLayers(key) {
  const s = SKIES[key] || SKIES.dia;
  return `<span class="sky-land"></span><span class="sky-sun"></span>${s.moon ? '<span class="sky-moon"></span>' : ''}<span class="sky-horizon"></span>`;
}

// emotions.js — vocabulario emocional.
// Cada familia agrupa palabras más precisas. FAMILIES es el orden en el selector;
// STACK_ORDER es el orden de apilado en los gráficos (validado para daltonismo).

export const FAMILIES = [
  {
    id: 'alegria',
    label: 'Alegría',
    valence: 1,
    words: ['alegría', 'gratitud', 'ilusión', 'orgullo', 'entusiasmo', 'alivio', 'satisfacción', 'diversión', 'ternura', 'esperanza', 'euforia'],
  },
  {
    id: 'calma',
    label: 'Calma',
    valence: 1,
    words: ['tranquilidad', 'serenidad', 'relajación', 'paz', 'seguridad', 'comodidad', 'concentración', 'conexión', 'confianza'],
  },
  {
    id: 'tristeza',
    label: 'Tristeza',
    valence: -1,
    words: ['tristeza', 'desánimo', 'soledad', 'vacío', 'nostalgia', 'decepción', 'dolor', 'culpa', 'vergüenza', 'desesperanza', 'melancolía'],
  },
  {
    id: 'miedo',
    label: 'Miedo / ansiedad',
    valence: -1,
    words: ['nerviosismo', 'inquietud', 'preocupación', 'agobio', 'inseguridad', 'tensión', 'miedo', 'bloqueo', 'alerta', 'pánico', 'angustia'],
  },
  {
    id: 'enfado',
    label: 'Enfado',
    valence: -1,
    words: ['irritación', 'frustración', 'molestia', 'rabia', 'resentimiento', 'indignación', 'impotencia', 'hartazgo', 'envidia', 'celos'],
  },
  {
    id: 'cansancio',
    label: 'Cansancio / apatía',
    valence: -1,
    words: ['cansancio', 'agotamiento', 'apatía', 'aburrimiento', 'indiferencia', 'saturación', 'desconexión', 'pereza', 'desgana'],
  },
  {
    id: 'sorpresa',
    label: 'Sorpresa',
    valence: 0,
    words: ['sorpresa', 'confusión', 'asombro', 'desconcierto', 'curiosidad', 'extrañeza'],
  },
  {
    id: 'rechazo',
    label: 'Rechazo / asco',
    valence: -1,
    words: ['asco', 'incomodidad', 'rechazo', 'desprecio', 'repulsión', 'desagrado'],
  },
];

/** Orden de apilado en gráficos. Validado con el validador de paleta (claro y oscuro). */
export const STACK_ORDER = ['alegria', 'rechazo', 'tristeza', 'enfado', 'miedo', 'cansancio', 'sorpresa', 'calma'];

/** Familia para palabras escritas a mano por la persona. */
export const OTHER_FAMILY = { id: 'otra', label: 'Otras', valence: 0, words: [] };

const byId = new Map(FAMILIES.map((f) => [f.id, f]));
byId.set(OTHER_FAMILY.id, OTHER_FAMILY);

export function familyOf(id) {
  return byId.get(id) || OTHER_FAMILY;
}

export function familyForWord(word) {
  const w = (word || '').trim().toLowerCase();
  for (const f of FAMILIES) if (f.words.includes(w)) return f;
  return OTHER_FAMILY;
}

export const PLACES = [
  { id: 'casa', label: 'Casa' },
  { id: 'trabajo', label: 'Trabajo / estudio' },
  { id: 'transporte', label: 'Transporte' },
  { id: 'calle', label: 'Calle / fuera' },
  { id: 'otro', label: 'Otro sitio' },
];

export const COMPANY = [
  { id: 'solo', label: 'A solas' },
  { id: 'pareja', label: 'Pareja' },
  { id: 'familia', label: 'Familia' },
  { id: 'amistades', label: 'Amistades' },
  { id: 'companeros', label: 'Compañeros' },
  { id: 'otros', label: 'Otras personas' },
];

export function labelFor(list, id) {
  const it = list.find((x) => x.id === id);
  return it ? it.label : '';
}

/** Texto para cada nivel de intensidad 0..10. */
export const INTENSITY_LABELS = [
  'nada',
  'apenas',
  'muy poco',
  'poco',
  'algo',
  'moderado',
  'bastante',
  'mucho',
  'muy fuerte',
  'intensísimo',
  'desbordante',
];

export function intensityLabel(n) {
  const i = Math.max(0, Math.min(10, Math.round(Number(n) || 0)));
  return INTENSITY_LABELS[i];
}

const CUSTOM_KEY = 'momento.customWords';

export function loadCustomWords() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

export function rememberCustomWord(word) {
  const w = (word || '').trim().toLowerCase();
  if (!w) return;
  const list = loadCustomWords().filter((x) => x !== w);
  list.unshift(w);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, 30)));
  } catch (e) {}
}

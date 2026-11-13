// Categorías por defecto y categorización por palabras clave + reglas aprendidas.

import type { Category, CategoryRule } from './types';
import { normalize } from './text';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'comida', name: 'Comida', emoji: '🍽️', color: '#E07A5F', kind: 'expense', biweeklyLimit: 0 },
  { id: 'mercado', name: 'Mercado', emoji: '🛒', color: '#81B29A', kind: 'expense', biweeklyLimit: 0 },
  { id: 'transporte', name: 'Transporte', emoji: '🚲', color: '#3D85C6', kind: 'expense', biweeklyLimit: 0 },
  { id: 'hogar', name: 'Hogar y servicios', emoji: '🏠', color: '#9C89B8', kind: 'expense', biweeklyLimit: 0 },
  { id: 'estudio', name: 'Estudio', emoji: '📚', color: '#F2B544', kind: 'expense', biweeklyLimit: 0 },
  { id: 'salud', name: 'Salud', emoji: '💊', color: '#4ECDC4', kind: 'expense', biweeklyLimit: 0 },
  { id: 'gym', name: 'Gimnasio', emoji: '🏋️', color: '#2A9D8F', kind: 'expense', biweeklyLimit: 0 },
  { id: 'ocio', name: 'Salidas y ocio', emoji: '🎉', color: '#EF476F', kind: 'expense', biweeklyLimit: 0 },
  { id: 'suscripciones', name: 'Suscripciones', emoji: '📺', color: '#6D597A', kind: 'expense', biweeklyLimit: 0 },
  { id: 'compras', name: 'Compras', emoji: '🛍️', color: '#B5838D', kind: 'expense', biweeklyLimit: 0 },
  { id: 'otros', name: 'Otros', emoji: '🧾', color: '#8D99AE', kind: 'expense', biweeklyLimit: 0 },
  { id: 'salario', name: 'Pago / salario', emoji: '💼', color: '#2E7D32', kind: 'income', biweeklyLimit: 0 },
  { id: 'otros_ingresos', name: 'Otros ingresos', emoji: '💰', color: '#43A047', kind: 'income', biweeklyLimit: 0 }
];

/** Palabras clave → categoría. Se compara sobre texto normalizado (sin tildes). */
const KEYWORDS: Array<[string, string[]]> = [
  ['comida', ['almuerzo', 'almorce', 'desayuno', 'comida', 'cena', 'comi', 'restaurante', 'corrientazo', 'empanada', 'hamburguesa', 'pizza', 'cafe', 'tinto', 'pan', 'onces', 'rappi', 'ifood', 'domicilio', 'arepa', 'crepes', 'frisby', 'kfc', 'mcdonald', 'juan valdez', 'oma', 'snack', 'helado']],
  ['mercado', ['mercado', 'supermercado', 'exito', 'carulla', 'd1', 'ara', 'olimpica', 'jumbo', 'makro', 'tienda', 'fruver', 'surtimax', 'pollo', 'pescado', 'huevos']],
  ['transporte', ['transporte', 'transmilenio', 'tm', 'bus', 'sitp', 'uber', 'didi', 'taxi', 'cabify', 'indriver', 'gasolina', 'parqueadero', 'peaje', 'bici', 'tullave', 'pasaje', 'metro']],
  ['hogar', ['arriendo', 'luz', 'agua', 'gas', 'internet', 'enel', 'codensa', 'vanti', 'acueducto', 'claro', 'movistar', 'tigo', 'wom', 'celular', 'plan', 'administracion']],
  ['estudio', ['universidad', 'semestre', 'matricula', 'libro', 'fotocopias', 'copias', 'impresion', 'cuaderno', 'curso', 'materiales', 'arduino', 'protoboard', 'resistencias', 'componentes', 'electronica']],
  ['salud', ['farmacia', 'drogueria', 'medicamento', 'cita', 'medico', 'eps', 'odontologo', 'cruz verde', 'farmatodo', 'creatina', 'vitamina', 'omega']],
  ['gym', ['gym', 'gimnasio', 'bodytech', 'smartfit', 'smart fit', 'mensualidad gym', 'proteina']],
  ['ocio', ['cine', 'cerveza', 'pola', 'bar', 'fiesta', 'rumba', 'concierto', 'boleta', 'salida', 'juego', 'steam', 'playstation', 'xbox']],
  ['suscripciones', ['netflix', 'spotify', 'disney', 'hbo', 'max', 'prime', 'youtube', 'chatgpt', 'icloud', 'google one', 'suscripcion', 'claude']],
  ['compras', ['ropa', 'zapatos', 'tenis', 'amazon', 'mercadolibre', 'mercado libre', 'falabella', 'temu', 'shein', 'regalo', 'compra']],
  ['salario', ['salario', 'sueldo', 'nomina', 'quincena', 'pago', 'me pagaron']],
  ['otros_ingresos', ['freelance', 'venta', 'vendi', 'regalaron', 'mesada', 'beca', 'reembolso', 'devolucion']]
];

/** Clave estable para recordar una corrección de categoría. */
export function ruleKey(description: string): string {
  const STOP = new Set(['en', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'por', 'para', 'y', 'al', 'mi', 'me']);
  return normalize(description)
    .split(' ')
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w))
    .slice(0, 3)
    .join(' ');
}

export function categorize(
  description: string,
  kind: 'expense' | 'income',
  rules: CategoryRule[],
  categories: Category[]
): { categoryId: string; learned: boolean } {
  const text = normalize(description);
  const valid = new Set(categories.filter((c) => c.kind === kind).map((c) => c.id));

  // 1) Reglas aprendidas: gana la clave más larga contenida en el texto.
  const key = ruleKey(description);
  const learned = rules
    .filter((r) => valid.has(r.categoryId) && r.key && (key === r.key || ` ${text} `.includes(` ${r.key} `)))
    .sort((a, b) => b.key.length - a.key.length || b.createdAt - a.createdAt)[0];
  if (learned) return { categoryId: learned.categoryId, learned: true };

  // 2) Palabras clave.
  for (const [cat, words] of KEYWORDS) {
    if (!valid.has(cat)) continue;
    if (words.some((w) => ` ${text} `.includes(` ${w} `))) return { categoryId: cat, learned: false };
  }
  return { categoryId: kind === 'income' ? 'otros_ingresos' : 'otros', learned: false };
}

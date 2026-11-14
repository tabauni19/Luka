import { describe, expect, it } from 'vitest';
import { parseSentence, amountFromParts, draftReady } from '../src/domain/parser';
import { DEFAULT_CATEGORIES } from '../src/domain/categories';
import type { Account } from '../src/domain/types';

const acc = (id: string, name: string, type: Account['type']): Account => ({ id, name, type, initialBalance: 0, color: '#000', createdAt: 0 });
const accounts = [acc('cash', 'Efectivo', 'cash'), acc('bc', 'Bancolombia', 'bank'), acc('nu', 'Nu', 'credit'), acc('lulo', 'Lulo', 'bank')];
const ctx = { accounts, categories: DEFAULT_CATEGORIES, rules: [], today: '2026-11-13' };

describe('montos', () => {
  it.each([
    ['12', 'k', 12000],
    ['12.500', undefined, 12500],
    ['120', 'mil', 120000],
    ['1,5', 'millones', 1500000],
    ['18', 'lucas', 18000],
    ['1.200.000', undefined, 1200000],
    ['2', 'palos', 2000000]
  ])('%s %s → %d', (n, u, v) => {
    expect(amountFromParts(n, u).value).toBe(v);
  });
  it('un número pequeño sin unidad es ambiguo', () => {
    expect(amountFromParts('18').ambiguous).toBe(true);
  });
});

describe('frase de ejemplo', () => {
  it('saca dos borradores con cuenta, categoría y fecha', () => {
    const d = parseSentence('Hoy gasté 18 lucas en almuerzo con Bancolombia y 12 mil en transporte en efectivo', ctx);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ kind: 'expense', amount: 18000, accountId: 'bc', categoryId: 'comida', date: '2026-11-13', description: 'Almuerzo' });
    expect(d[1]).toMatchObject({ kind: 'expense', amount: 12000, accountId: 'cash', categoryId: 'transporte', date: '2026-11-13', description: 'Transporte' });
    expect(d.every(draftReady)).toBe(true);
  });

  it('entiende ayer, 12k y 12.500', () => {
    const d = parseSentence('ayer 12k de tinto con nu, 12.500 en uber con lulo', ctx);
    expect(d.map((x) => [x.amount, x.date, x.accountId, x.categoryId])).toEqual([
      [12000, '2026-11-12', 'nu', 'comida'],
      [12500, '2026-11-12', 'lulo', 'transporte']
    ]);
  });

  it('1,5 millones y 120 mil', () => {
    const d = parseSentence('pagué 1,5 millones de arriendo con bancolombia y 120 mil de mercado en el éxito con nu', ctx);
    expect(d.map((x) => x.amount)).toEqual([1500000, 120000]);
    expect(d[0].categoryId).toBe('hogar');
    expect(d[1].categoryId).toBe('mercado');
  });

  it('pide aclaración: monto sin unidad y cuenta faltante', () => {
    const [d] = parseSentence('gasté 18 en almuerzo', ctx);
    expect(d.amount).toBeNull();
    expect(d.issues).toContainEqual({ type: 'amount_ambiguous', options: [18, 18000] });
    expect(d.issues).toContainEqual({ type: 'account_missing' });
    expect(draftReady(d)).toBe(false);
  });

  it('transferencia y pago de tarjeta', () => {
    const [t] = parseSentence('pasé 100 mil de bancolombia a lulo', ctx);
    expect(t).toMatchObject({ kind: 'transfer', amount: 100000, accountId: 'bc', toAccountId: 'lulo' });
    const [p] = parseSentence('pagué la tarjeta nu con 80 mil de bancolombia', ctx);
    expect(p).toMatchObject({ kind: 'transfer', amount: 80000, accountId: 'bc', toAccountId: 'nu' });
    const [c] = parseSentence('80 mil en tenis con nu', ctx);
    expect(c).toMatchObject({ kind: 'expense', accountId: 'nu' });
  });

  it('ingreso', () => {
    const [i] = parseSentence('me pagaron 1.200.000 en bancolombia', ctx);
    expect(i).toMatchObject({ kind: 'income', amount: 1200000, accountId: 'bc', categoryId: 'salario' });
  });

  it('fechas con número no se confunden con montos', () => {
    const [d] = parseSentence('el 5 de noviembre gasté 30 mil en cine con nu', ctx);
    expect(d).toMatchObject({ amount: 30000, date: '2026-11-05', categoryId: 'ocio' });
    const [e] = parseSentence('el lunes 20 lucas en mercado efectivo', ctx);
    expect(e).toMatchObject({ amount: 20000, date: '2026-11-09' });
  });

  it('dos lucas y medio palo', () => {
    const d = parseSentence('dos lucas de tinto en efectivo y medio palo de matrícula con bancolombia', ctx);
    expect(d.map((x) => x.amount)).toEqual([2000, 500000]);
  });
});

describe('categorías ocultas', () => {
  it('no se asignan automáticamente: cae en Otros', async () => {
    const { categorize } = await import('../src/domain/categories');
    const { DEFAULT_CATEGORIES } = await import('../src/domain/categories');
    const visible = categorize('arriendo', 'expense', [], DEFAULT_CATEGORIES).categoryId;
    expect(visible).not.toBe('otros');
    const hidden = DEFAULT_CATEGORIES.map((c) => (c.id === visible ? { ...c, hidden: true } : c));
    expect(categorize('arriendo', 'expense', [], hidden).categoryId).toBe('otros');
  });
});

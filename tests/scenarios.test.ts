// Casos de verificación pedidos explícitamente.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Repo } from '../src/data/repo';
import { accountBalances, totalExpenses, totals } from '../src/domain/ledger';
import { availability } from '../src/domain/budget';
import { parseSentence } from '../src/domain/parser';
import type { Account, Commitment, Transaction } from '../src/domain/types';
import { transactionsToCSV } from '../src/domain/csv';

const TODAY = '2026-11-13';
let repo: Repo;
let n = 0;

const account = (id: string, name: string, type: Account['type'], initialBalance: number): Account => ({ id, name, type, initialBalance, color: '#000', createdAt: n++ });
const tx = (p: Partial<Transaction> & Pick<Transaction, 'kind' | 'amount' | 'accountId'>): Transaction => ({
  id: `t${n++}`, date: TODAY, description: 'x', source: 'manual', createdAt: n, updatedAt: n, categoryId: p.kind === 'transfer' ? undefined : 'otros', ...p
});

beforeEach(async () => {
  repo = await Repo.open(`test-${Math.random()}`);
  await repo.bulkPut({
    accounts: [account('bc', 'Bancolombia', 'bank', 1_000_000), account('lulo', 'Lulo', 'bank', 0), account('nu', 'Nu', 'credit', 0), account('cash', 'Efectivo', 'cash', 50_000)]
  });
});

describe('flujo central: frase → borradores → corregir → guardar → recargar', () => {
  it('registra dos gastos de una frase y los totales sobreviven a recargar', async () => {
    let data = await repo.load();
    const drafts = parseSentence('Hoy gasté 18 lucas en almuerzo con Bancolombia y 12 mil en transporte en efectivo', { ...data, today: TODAY });
    expect(drafts).toHaveLength(2);
    const suggested = Object.fromEntries(drafts.map((d) => [d.id, d.categoryId]));
    // corrección: el transporte era en realidad "estudio" (p. ej. pasaje a la U) y el almuerzo 19.000
    drafts[0].amount = 19_000;
    drafts[1].categoryId = 'estudio';
    expect(await repo.saveDrafts(drafts, 'texto', suggested)).toBe(2);

    // "recargar": cerramos y abrimos la base de nuevo
    data = await repo.load();
    const bal = accountBalances(data.accounts, data.transactions);
    expect(bal.get('bc')).toBe(1_000_000 - 19_000);
    expect(bal.get('cash')).toBe(50_000 - 12_000);
    expect(totalExpenses(data.transactions)).toBe(31_000);

    // la corrección de categoría quedó aprendida para frases parecidas
    const again = parseSentence('12 mil en transporte en efectivo', { ...data, today: TODAY });
    expect(again[0].categoryId).toBe('estudio');
    expect(again[0].learnedCategory).toBe(true);
  });

  it('guardar dos veces el mismo borrador no duplica movimientos', async () => {
    const data = await repo.load();
    const drafts = parseSentence('20 mil en mercado con lulo', { ...data, today: TODAY });
    await repo.saveDrafts(drafts, 'texto');
    await repo.saveDrafts(drafts, 'texto');
    await Promise.all([repo.saveDrafts(drafts, 'texto'), repo.saveDrafts(drafts, 'texto')]);
    expect((await repo.load()).transactions).toHaveLength(1);
  });

  it('editar y eliminar un movimiento actualiza la cuenta', async () => {
    const t = tx({ kind: 'expense', amount: 30_000, accountId: 'bc' });
    await repo.putTransaction(t);
    await repo.putTransaction({ ...t, amount: 45_000 });
    let d = await repo.load();
    expect(accountBalances(d.accounts, d.transactions).get('bc')).toBe(955_000);
    await repo.deleteTransaction(t.id);
    d = await repo.load();
    expect(accountBalances(d.accounts, d.transactions).get('bc')).toBe(1_000_000);
  });
});

describe('transferencias y tarjetas', () => {
  it('una transferencia de $100.000 no cambia el gasto total', async () => {
    await repo.putTransaction(tx({ kind: 'expense', amount: 25_000, accountId: 'bc' }));
    const before = totalExpenses((await repo.load()).transactions);
    await repo.putTransaction(tx({ kind: 'transfer', amount: 100_000, accountId: 'bc', toAccountId: 'lulo' }));
    const d = await repo.load();
    expect(totalExpenses(d.transactions)).toBe(before);
    expect(totals(d).liquid).toBe(1_050_000 - 25_000); // el líquido total tampoco cambia
    const bal = accountBalances(d.accounts, d.transactions);
    expect(bal.get('bc')).toBe(875_000);
    expect(bal.get('lulo')).toBe(100_000);
  });

  it('compra de $80.000 con tarjeta y su pago completo: $80.000 en gastos y $0 de deuda', async () => {
    await repo.putTransaction(tx({ kind: 'expense', amount: 80_000, accountId: 'nu' }));
    let d = await repo.load();
    expect(totals(d).debt).toBe(80_000);
    expect(totals(d).liquid).toBe(1_050_000); // la compra con tarjeta no toca el banco

    const [pay] = parseSentence('pagué la tarjeta nu con 80 mil de bancolombia', { ...d, today: TODAY });
    expect(pay.kind).toBe('transfer');
    await repo.saveDrafts([pay], 'texto');
    d = await repo.load();
    expect(totalExpenses(d.transactions)).toBe(80_000);
    expect(totals(d).debt).toBe(0);
    expect(accountBalances(d.accounts, d.transactions).get('bc')).toBe(920_000);
  });
});

describe('disponible hasta el próximo pago', () => {
  const factura: Commitment = { id: 'luz', name: 'Luz', amount: 60_000, dayOfMonth: 20, categoryId: 'hogar', accountId: 'bc', active: true };

  it('marcar una factura como pagada no la descuenta dos veces', async () => {
    await repo.saveSettings({ payDays: [15, 30] });
    await repo.put('commitments', factura);
    let d = await repo.load();
    let av = availability(d, TODAY);
    // próximo pago: 15 nov. La luz vence el 20 → no entra en esta quincena.
    expect(av.nextPay).toBe('2026-11-15');
    expect(av.pendingCommitments).toBe(0);

    // con fecha de pago el 25, la luz sí está pendiente
    await repo.saveSettings({ payDays: [10, 25] });
    d = await repo.load();
    av = availability(d, TODAY);
    expect(av.nextPay).toBe('2026-11-25');
    expect(av.pendingCommitments).toBe(60_000);
    const before = av.available;
    expect(before).toBe(1_050_000 - 60_000);

    await repo.payCommitment(factura, '2026-11-20', 'bc', TODAY);
    await repo.payCommitment(factura, '2026-11-20', 'bc', TODAY); // doble clic
    d = await repo.load();
    av = availability(d, TODAY);
    expect(d.transactions).toHaveLength(1);
    expect(av.pendingCommitments).toBe(0);
    expect(av.available).toBe(before); // mismo disponible: se descontó UNA vez
    expect(av.daysLeft).toBe(12);
    expect(av.perDay).toBe(Math.floor(before / 12));

    // si borras el pago, vuelve a estar pendiente
    await repo.unpayCommitment('luz', '2026-11-20');
    d = await repo.load();
    expect(availability(d, TODAY).pendingCommitments).toBe(60_000);
    expect(availability(d, TODAY).available).toBe(before);
  });

  it('descuenta lo separado para metas y muestra faltante', async () => {
    await repo.saveSettings({ payDays: [10, 25] });
    await repo.put('goals', { id: 'g', name: 'Viaje', emoji: '✈️', target: 3_000_000, deadline: '2027-06-01', createdAt: 0 });
    await repo.put('goalContributions', { id: 'gc', goalId: 'g', amount: 1_000_000, date: TODAY });
    await repo.put('commitments', { ...factura, amount: 100_000 });
    const av = availability(await repo.load(), TODAY);
    expect(av.reservedGoals).toBe(1_000_000);
    expect(av.available).toBe(1_050_000 - 1_000_000 - 100_000);
    expect(av.shortfall).toBe(50_000);
    expect(av.perDay).toBe(0);
  });

  it('se puede dejar las metas aparte sin descontarlas del disponible', async () => {
    await repo.saveSettings({ payDays: [10, 25], goalsReduceAvailable: false });
    await repo.put('goals', { id: 'g', name: 'Moto', emoji: '🏍️', target: 8_000_000, deadline: '2027-06-01', createdAt: 0 });
    await repo.put('goalContributions', { id: 'gc', goalId: 'g', amount: 2_600_000, date: TODAY });
    const av = availability(await repo.load(), TODAY);
    expect(av.goalsExcluded).toBe(true);
    expect(av.available).toBe(1_050_000);
    expect(av.shortfall).toBe(0);
  });

  it('compromiso quincenal: dos ocurrencias al mes, cada una se paga una vez', async () => {
    const { commitmentOccurrences } = await import('../src/domain/budget');
    const c: Commitment = { id: 'nu-q', name: 'Pago Nu', amount: 50_000, dayOfMonth: 15, secondDay: 30, cardAccountId: 'nu', accountId: 'bc', active: true };
    await repo.put('commitments', c);
    let d = await repo.load();
    const occ = commitmentOccurrences(d, '2026-11-01', '2026-12-01', TODAY);
    expect(occ.map((o) => o.dueDate)).toEqual(['2026-11-15', '2026-11-30']);
    await repo.payCommitment(c, '2026-11-15', 'bc', TODAY);
    d = await repo.load();
    expect(commitmentOccurrences(d, '2026-11-01', '2026-12-01', TODAY).map((o) => o.paid)).toEqual([true, false]);
    // febrero: el 30 se recorta al 28
    expect(commitmentOccurrences(d, '2027-02-01', '2027-03-01', TODAY).map((o) => o.dueDate)).toEqual(['2027-02-15', '2027-02-28']);
  });

  it('sin fecha de pago pide configurarla', async () => {
    const av = availability(await repo.load(), TODAY);
    expect(av.nextPay).toBeNull();
  });

  it('pago de tarjeta como compromiso es transferencia, no gasto', async () => {
    await repo.saveSettings({ payDays: [10, 25] });
    await repo.putTransaction(tx({ kind: 'expense', amount: 80_000, accountId: 'nu' }));
    const c: Commitment = { id: 'nu-pay', name: 'Pago Nu', amount: 80_000, dayOfMonth: 18, cardAccountId: 'nu', accountId: 'bc', active: true };
    await repo.put('commitments', c);
    await repo.payCommitment(c, '2026-11-18', 'bc', TODAY);
    const d = await repo.load();
    expect(totalExpenses(d.transactions)).toBe(80_000);
    expect(totals(d).debt).toBe(0);
  });
});

describe('respaldo y exportación', () => {
  it('exporta e importa JSON sin perder nada, y CSV tiene una fila por movimiento', async () => {
    await repo.putTransaction(tx({ kind: 'expense', amount: 12_345, accountId: 'bc', description: 'Café; "especial"' }));
    const backup = JSON.parse(JSON.stringify(await repo.exportAll()));
    const other = await Repo.open(`test-${Math.random()}`);
    await other.importAll(backup);
    const d = await other.load();
    expect(d.transactions).toHaveLength(1);
    expect(totals(d).liquid).toBe(1_050_000 - 12_345);
    const csv = transactionsToCSV(d);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"Café; ""especial"""');
    await expect(other.importAll({ foo: 1 })).rejects.toThrow();
  });

  it('el modo demo se borra de una vez sin tocar tus datos', async () => {
    const { loadDemo } = await import('../src/data/demo');
    await repo.putTransaction(tx({ kind: 'expense', amount: 1_000, accountId: 'bc' }));
    await loadDemo(repo, TODAY);
    let d = await repo.load();
    expect(d.transactions.length).toBeGreaterThan(5);
    expect(d.settings.payDays).toEqual([15, 30]);
    await repo.clearDemo();
    d = await repo.load();
    expect(d.transactions).toHaveLength(1);
    expect(d.accounts).toHaveLength(4);
    expect(d.goals).toHaveLength(0);
    expect(d.settings.payDays).toEqual([]);
    expect(d.settings.demoMode).toBe(false);
  });
});

// Registro automático (Android) con notificaciones SIMULADAS.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Repo } from '../src/data/repo';
import { processCaptures, WALLET_PACKAGE, type CapturedEvent } from '../src/domain/capture';
import { accountBalances, totalExpenses } from '../src/domain/ledger';

const BANCO = 'com.todo1.mobile';
const T0 = Date.parse('2026-11-13T17:30:00Z'); // 12:30 p. m. en Bogotá
let repo: Repo;

const ev = (p: Partial<CapturedEvent>): CapturedEvent => ({ id: `e${Math.random()}`, app: WALLET_PACKAGE, postedAt: T0, declined: false, ...p });

async function run(events: CapturedEvent[]) {
  const data = await repo.load();
  const r = processCaptures(events, data, T0);
  await repo.applyCaptureResult(r);
  return r;
}

beforeEach(async () => {
  repo = await Repo.open(`cap-${Math.random()}`);
  await repo.bulkPut({
    accounts: [
      { id: 'nu', name: 'Nu', type: 'credit', initialBalance: 0, color: '#000', createdAt: 0 },
      { id: 'bc', name: 'Bancolombia', type: 'bank', initialBalance: 500_000, color: '#000', createdAt: 1 }
    ],
    cardLinks: [{ id: `${WALLET_PACKAGE}:4321`, app: WALLET_PACKAGE, last4: '4321', label: 'Wallet 4321', accountId: 'nu' }]
  });
  await repo.saveSettings({ autoCapture: { enabled: true, sources: [WALLET_PACKAGE, BANCO] } });
});

describe('captura de Google Wallet', () => {
  it('compra completa se guarda sola, etiquetada, y se puede deshacer', async () => {
    const r = await run([ev({ id: 'a', amount: 23_500, currency: 'COP', merchant: 'Juan Valdez Café', cardLast4: '4321' })]);
    expect(r.transactions).toHaveLength(1);
    let d = await repo.load();
    const t = d.transactions[0];
    expect(t).toMatchObject({ source: 'google_wallet', accountId: 'nu', amount: 23_500, categoryId: 'comida', date: '2026-11-13' });
    expect(accountBalances(d.accounts, d.transactions).get('nu')).toBe(23_500);
    await repo.deleteTransaction(t.id); // deshacer
    d = await repo.load();
    expect(d.transactions).toHaveLength(0);
    // y no se vuelve a crear si la cola la reenvía
    const again = await run([ev({ id: 'a', amount: 23_500, currency: 'COP', cardLast4: '4321' })]);
    expect(again.transactions).toHaveLength(0);
  });

  it('datos incompletos → Por revisar, sin tocar saldos', async () => {
    const r = await run([
      ev({ id: 'sin-monto', merchant: 'Tienda', cardLast4: '4321' }),
      ev({ id: 'sin-cuenta', amount: 10_000, currency: 'COP', cardLast4: '9999', postedAt: T0 + 3_600_000 }),
      ev({ id: 'usd', amount: 20, currency: 'USD', cardLast4: '4321', postedAt: T0 + 7_200_000 })
    ]);
    expect(r.transactions).toHaveLength(0);
    expect(r.reviewItems.map((i) => i.reason)).toEqual(['falta_monto', 'falta_cuenta', 'moneda_extranjera']);
    expect(r.newCardLinks.map((l) => l.last4)).toEqual(['9999']);
    const d = await repo.load();
    expect(d.reviewItems).toHaveLength(3);
    expect(accountBalances(d.accounts, d.transactions).get('nu')).toBe(0);

    // al confirmarlo, recién ahí cambia el saldo
    const item = d.reviewItems.find((i) => i.id === 'sin-cuenta')!;
    await repo.confirmReview(item, { kind: 'expense', amount: 10_000, date: item.date, description: 'Tienda', accountId: 'bc', categoryId: 'otros' });
    const d2 = await repo.load();
    expect(d2.reviewItems).toHaveLength(2);
    expect(accountBalances(d2.accounts, d2.transactions).get('bc')).toBe(490_000);
  });

  it('una compra rechazada jamás cuenta como gasto', async () => {
    const r = await run([ev({ id: 'x', amount: 50_000, currency: 'COP', cardLast4: '4321', declined: true })]);
    expect(r.transactions).toHaveLength(0);
    expect(r.reviewItems).toHaveLength(0);
    expect(r.ignored).toEqual([{ id: 'x', reason: 'rechazada' }]);
    expect(totalExpenses((await repo.load()).transactions)).toBe(0);
  });

  it('Wallet y banco avisan la misma compra (misma tarjeta) → un solo gasto', async () => {
    const r = await run([
      ev({ id: 'w', amount: 80_000, currency: 'COP', merchant: 'Éxito Unicentro', cardLast4: '4321' }),
      ev({ id: 'b', app: BANCO, amount: 80_000, currency: 'COP', merchant: 'EXITO UNICENTRO BOG', cardLast4: '4321', postedAt: T0 + 40_000 })
    ]);
    expect(r.transactions).toHaveLength(1);
    expect(r.ignored).toContainEqual({ id: 'b', reason: 'duplicado' });
    expect(totalExpenses((await repo.load()).transactions)).toBe(80_000);
  });

  it('mismo monto y hora pero sin evidencia → posible duplicado para revisar', async () => {
    await run([ev({ id: 'w', amount: 35_000, currency: 'COP', merchant: 'Cine Colombia', cardLast4: '4321' })]);
    const r = await run([ev({ id: 'b', app: BANCO, amount: 35_000, currency: 'COP', postedAt: T0 + 120_000 })]);
    expect(r.transactions).toHaveLength(0);
    expect(r.reviewItems[0]).toMatchObject({ reason: 'posible_duplicado', duplicateOfTxId: 'cap:w' });
    expect(totalExpenses((await repo.load()).transactions)).toBe(35_000);
  });

  it('solo procesa fuentes habilitadas', async () => {
    const r = await run([ev({ id: 'z', app: 'com.otra.app', amount: 1_000, currency: 'COP' })]);
    expect(r.ignored).toEqual([{ id: 'z', reason: 'fuente_no_habilitada' }]);
  });

  it('un gasto ya registrado a mano el mismo día con el mismo monto se marca para revisar', async () => {
    await repo.putTransaction({ id: 'm', kind: 'expense', amount: 18_000, date: '2026-11-13', description: 'Almuerzo', accountId: 'nu', categoryId: 'comida', source: 'texto', createdAt: T0 - 3_600_000, updatedAt: 0 });
    const r = await run([ev({ id: 'w2', amount: 18_000, currency: 'COP', merchant: 'Restaurante', cardLast4: '4321' })]);
    expect(r.reviewItems[0]?.reason).toBe('posible_duplicado');
  });
});

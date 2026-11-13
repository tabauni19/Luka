// Libro contable: todo se DERIVA de cuentas + movimientos.
// No guardamos saldos: si editas o borras un movimiento, el saldo se recalcula solo.
//
// Convención de signos por cuenta:
//   - Cuentas normales (efectivo, banco, billetera): saldo = plata que tienes.
//   - Tarjetas de crédito: guardamos DEUDA en positivo.
//
// Efecto de cada tipo de movimiento:
//   gasto con cuenta normal   → saldo -= monto            (cuenta como gasto)
//   gasto con tarjeta         → deuda += monto            (cuenta como gasto)
//   ingreso                   → saldo += monto
//   transferencia A → B       → A -= monto, B += monto    (NO es gasto)
//   transferencia A → tarjeta → A -= monto, deuda -= monto (pago de tarjeta, NO es gasto)

import type { Account, AppData, ISODate, Transaction } from './types';

export function isCredit(a: Pick<Account, 'type'> | undefined): boolean {
  return a?.type === 'credit';
}

/** Saldo (o deuda, si es tarjeta) de cada cuenta. */
export function accountBalances(accounts: Account[], txs: Transaction[]): Map<string, number> {
  const bal = new Map<string, number>();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const a of accounts) bal.set(a.id, a.initialBalance);

  const add = (id: string | undefined, delta: number) => {
    if (!id || !bal.has(id)) return;
    bal.set(id, (bal.get(id) ?? 0) + delta);
  };

  for (const t of txs) {
    const from = byId.get(t.accountId);
    if (t.kind === 'expense') {
      add(t.accountId, isCredit(from) ? +t.amount : -t.amount);
    } else if (t.kind === 'income') {
      add(t.accountId, isCredit(from) ? -t.amount : +t.amount);
    } else if (t.kind === 'transfer') {
      const to = t.toAccountId ? byId.get(t.toAccountId) : undefined;
      // sale de la cuenta origen (si el origen es tarjeta = avance → aumenta deuda)
      add(t.accountId, isCredit(from) ? +t.amount : -t.amount);
      // entra a la cuenta destino (si es tarjeta = pago → baja la deuda)
      add(t.toAccountId, isCredit(to) ? -t.amount : +t.amount);
    }
  }
  return bal;
}

export interface Totals {
  /** Plata en cuentas no crédito. */
  liquid: number;
  /** Deuda total en tarjetas. */
  debt: number;
  /** Patrimonio simple: líquido - deuda. */
  net: number;
}

export function totals(data: Pick<AppData, 'accounts' | 'transactions'>): Totals {
  const bal = accountBalances(data.accounts, data.transactions);
  let liquid = 0;
  let debt = 0;
  for (const a of data.accounts) {
    if (a.archived) continue;
    const b = bal.get(a.id) ?? 0;
    if (isCredit(a)) debt += b;
    else liquid += b;
  }
  return { liquid, debt, net: liquid - debt };
}

/** Total de GASTOS (las transferencias y pagos de tarjeta nunca suman aquí). */
export function totalExpenses(txs: Transaction[], from?: ISODate, to?: ISODate): number {
  return txs
    .filter((t) => t.kind === 'expense' && (!from || t.date >= from) && (!to || t.date < to))
    .reduce((s, t) => s + t.amount, 0);
}

export function totalIncome(txs: Transaction[], from?: ISODate, to?: ISODate): number {
  return txs
    .filter((t) => t.kind === 'income' && (!from || t.date >= from) && (!to || t.date < to))
    .reduce((s, t) => s + t.amount, 0);
}

/** Gasto por categoría en un rango [from, to). */
export function expensesByCategory(txs: Transaction[], from?: ISODate, to?: ISODate): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of txs) {
    if (t.kind !== 'expense') continue;
    if (from && t.date < from) continue;
    if (to && t.date >= to) continue;
    const k = t.categoryId ?? 'sin_categoria';
    m.set(k, (m.get(k) ?? 0) + t.amount);
  }
  return m;
}

/** Orden estable: más reciente primero (fecha y luego momento de creación). */
export function sortTxs(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

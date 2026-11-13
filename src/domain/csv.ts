import type { AppData } from './types';
import { sortTxs } from './ledger';

const KIND: Record<string, string> = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia' };

function cell(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con separador ";" (Excel en español lo abre bien) y BOM para tildes. */
export function transactionsToCSV(data: Pick<AppData, 'transactions' | 'accounts' | 'categories'>): string {
  const acc = new Map(data.accounts.map((a) => [a.id, a.name]));
  const cat = new Map(data.categories.map((c) => [c.id, c.name]));
  const header = ['Fecha', 'Tipo', 'Descripción', 'Categoría', 'Cuenta', 'Cuenta destino', 'Monto (COP)', 'Origen'];
  const rows = sortTxs(data.transactions).map((t) => [
    t.date,
    KIND[t.kind],
    t.description,
    t.categoryId ? cat.get(t.categoryId) ?? t.categoryId : '',
    acc.get(t.accountId) ?? t.accountId,
    t.toAccountId ? acc.get(t.toAccountId) ?? t.toAccountId : '',
    t.kind === 'expense' ? -t.amount : t.amount,
    t.source
  ]);
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}

// Datos FICTICIOS para el modo demo. Todo lleva `demo: true` y se borra de una vez
// desde Ajustes. Fuera del modo demo la app no muestra ninguna cifra inventada.

import { addDays, addMonths, parseISO } from '../domain/dates';
import { commitmentOccurrences, periodFor } from '../domain/budget';
import type { Account, Commitment, CommitmentPayment, Goal, GoalContribution, Transaction } from '../domain/types';
import type { Repo } from './repo';

export async function loadDemo(repo: Repo, today: string) {
  const now = Date.now();
  const A = (id: string, name: string, type: Account['type'], initialBalance: number, color: string, creditLimit?: number): Account => ({
    id: `demo-${id}`, name, type, initialBalance, color, creditLimit, demo: true, createdAt: now
  });
  const accounts = [
    A('efectivo', 'Efectivo', 'cash', 85_000, '#F2B544'),
    A('bancolombia', 'Bancolombia', 'bank', 640_000, '#FDDA24'),
    A('lulo', 'Lulo', 'bank', 210_000, '#C6F432'),
    A('nu', 'Nu', 'credit', 0, '#820AD1', 1_500_000)
  ];

  let n = 0;
  const T = (daysAgo: number, kind: Transaction['kind'], amount: number, description: string, accountId: string, categoryId?: string, toAccountId?: string): Transaction => ({
    id: `demo-tx-${n++}`, kind, amount, date: addDays(today, -daysAgo), description,
    accountId: `demo-${accountId}`, toAccountId: toAccountId ? `demo-${toAccountId}` : undefined,
    categoryId, source: 'manual', demo: true, createdAt: now - daysAgo * 86400000 + n, updatedAt: now
  });
  const transactions = [
    T(12, 'income', 1_100_000, 'Pago quincena', 'bancolombia', 'salario'),
    T(11, 'expense', 18_000, 'Almuerzo', 'bancolombia', 'comida'),
    T(10, 'expense', 12_000, 'Transporte', 'efectivo', 'transporte'),
    T(9, 'expense', 96_000, 'Mercado Carulla', 'nu', 'mercado'),
    T(8, 'transfer', 100_000, 'Paso a Lulo', 'bancolombia', undefined, 'lulo'),
    T(7, 'expense', 35_000, 'Cine con Sofi', 'lulo', 'ocio'),
    T(6, 'expense', 24_900, 'Spotify + iCloud', 'nu', 'suscripciones'),
    T(5, 'expense', 15_500, 'Fotocopias y componentes', 'efectivo', 'estudio'),
    T(4, 'expense', 22_000, 'Corrientazo y jugo', 'bancolombia', 'comida'),
    T(3, 'expense', 80_000, 'Mensualidad gym', 'bancolombia', 'gym'),
    T(2, 'transfer', 60_000, 'Pago tarjeta Nu', 'bancolombia', undefined, 'nu'),
    T(1, 'expense', 9_000, 'Tinto y pan', 'efectivo', 'comida'),
    T(0, 'expense', 14_000, 'Uber a la U', 'lulo', 'transporte')
  ];

  const commitments: Commitment[] = [
    { id: 'demo-c-arriendo', name: 'Arriendo (parte mía)', amount: 450_000, dayOfMonth: 1, categoryId: 'hogar', accountId: 'demo-bancolombia', active: true, demo: true },
    { id: 'demo-c-celular', name: 'Plan de celular', amount: 55_000, dayOfMonth: parseISO(addDays(today, 3)).d, categoryId: 'hogar', accountId: 'demo-bancolombia', active: true, demo: true },
    { id: 'demo-c-nu', name: 'Pago tarjeta Nu', amount: 120_000, dayOfMonth: parseISO(addDays(today, 5)).d, cardAccountId: 'demo-nu', accountId: 'demo-bancolombia', active: true, demo: true }
  ];

  const goals: Goal[] = [
    { id: 'demo-g-viaje', name: 'Viaje (ejemplo)', emoji: '✈️', target: 3_500_000, deadline: addMonths(today, 8), demo: true, createdAt: now },
    { id: 'demo-g-celular', name: 'Celular nuevo (ejemplo)', emoji: '📱', target: 1_800_000, deadline: addMonths(today, 4), demo: true, createdAt: now + 1 }
  ];
  const goalContributions: GoalContribution[] = [
    { id: 'demo-gc-1', goalId: 'demo-g-viaje', amount: 400_000, date: addDays(today, -40), demo: true },
    { id: 'demo-gc-2', goalId: 'demo-g-viaje', amount: 150_000, date: addDays(today, -12), demo: true },
    { id: 'demo-gc-3', goalId: 'demo-g-celular', amount: 300_000, date: addDays(today, -12), demo: true }
  ];

  // Los compromisos que ya vencieron en esta quincena aparecen pagados (con su movimiento).
  const period = periodFor(today, [15, 30]);
  const commitmentPayments: CommitmentPayment[] = [];
  for (const o of commitmentOccurrences({ commitments, commitmentPayments: [] }, period.start, period.end, today)) {
    if (o.dueDate > today) continue;
    const c = o.commitment;
    const txId = `pay:${c.id}:${o.dueDate}`;
    transactions.push({
      id: txId, kind: c.cardAccountId ? 'transfer' : 'expense', amount: c.amount, date: o.dueDate, description: c.name,
      accountId: c.accountId!, toAccountId: c.cardAccountId, categoryId: c.cardAccountId ? undefined : c.categoryId,
      source: 'compromiso', commitmentId: c.id, demo: true, createdAt: now - 1, updatedAt: now
    });
    commitmentPayments.push({ id: `${c.id}:${o.dueDate}`, commitmentId: c.id, dueDate: o.dueDate, txId, paidAt: now, demo: true });
  }

  await repo.bulkPut({ accounts, transactions, commitments, commitmentPayments, goals, goalContributions });
  const cur = (await repo.load()).settings;
  await repo.saveSettings(
    cur.payDays.length ? { demoMode: true, onboarded: true } : { demoMode: true, onboarded: true, payDays: [15, 30], demoPayDays: true }
  );
}

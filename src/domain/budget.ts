// Presupuesto por quincena: "¿Cuánto me queda libre hasta el próximo pago?"
//
//   Disponible = saldo líquido
//              − plata separada para metas
//              − compromisos pendientes antes del próximo pago
//
// Un compromiso pagado ya bajó el saldo líquido (porque al pagarlo se registra
// el movimiento), así que deja de contarse como pendiente. Así se descuenta UNA sola vez.

import { addDays, addMonths, clampDay, diffDays, formatShort, parseISO } from './dates';
import { totals } from './ledger';
import type { AppData, Commitment, Goal, ISODate } from './types';

export interface Period {
  start: ISODate; // incluido
  end: ISODate; // excluido (= día de pago siguiente)
  label: string;
}

/** Todas las fechas de pago de un mes dado. */
function payDatesInMonth(y: number, m: number, payDays: number[]): ISODate[] {
  return [...new Set(payDays.map((d) => clampDay(y, m, d)))].sort();
}

/** Fechas de pago alrededor de `ref`, ordenadas. */
function payDatesAround(ref: ISODate, payDays: number[], monthsBack = 2, monthsFwd = 2): ISODate[] {
  const { y, m } = parseISO(ref);
  const out: ISODate[] = [];
  for (let k = -monthsBack; k <= monthsFwd; k++) {
    const first = addMonths(clampDay(y, m, 1), k);
    const p = parseISO(first);
    out.push(...payDatesInMonth(p.y, p.m, payDays));
  }
  return [...new Set(out)].sort();
}

const DEFAULT_QUINCENAS = [1, 16];

/** Quincena (periodo entre pagos) que contiene `date`. Si no hay días de pago, usa 1–15 y 16–fin de mes. */
export function periodFor(date: ISODate, payDays: number[]): Period {
  const days = payDays.length ? payDays : DEFAULT_QUINCENAS;
  const dates = payDatesAround(date, days);
  let start = dates[0];
  let end = dates[dates.length - 1];
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] <= date) start = dates[i];
    if (dates[i] > date) {
      end = dates[i];
      break;
    }
  }
  return { start, end, label: `${formatShort(start)} – ${formatShort(addDays(end, -1))}` };
}

/** Las últimas `n` quincenas, la actual primero. */
export function recentPeriods(today: ISODate, payDays: number[], n = 6): Period[] {
  const out: Period[] = [];
  let ref = today;
  for (let i = 0; i < n; i++) {
    const p = periodFor(ref, payDays);
    out.push(p);
    ref = addDays(p.start, -1);
  }
  return out;
}

/** Próximo día de pago (estrictamente después de hoy) o null si falta configurarlo. */
export function nextPayDate(today: ISODate, settings: AppData['settings']): ISODate | null {
  const o = settings.nextPayDateOverride;
  const candidates: ISODate[] = [];
  if (o && o > today) candidates.push(o);
  if (settings.payDays.length) {
    const next = payDatesAround(today, settings.payDays, 0, 2).find((d) => d > today);
    if (next) candidates.push(next);
  }
  if (!candidates.length) return null;
  return candidates.sort()[0];
}

export interface CommitmentOccurrence {
  commitment: Commitment;
  dueDate: ISODate;
  paid: boolean;
  overdue: boolean;
}

/** Ocurrencias de compromisos con vencimiento en [from, to). */
export function commitmentOccurrences(
  data: Pick<AppData, 'commitments' | 'commitmentPayments'>,
  from: ISODate,
  to: ISODate,
  today: ISODate
): CommitmentOccurrence[] {
  const paid = new Set(data.commitmentPayments.map((p) => p.id));
  const out: CommitmentOccurrence[] = [];
  for (const c of data.commitments) {
    if (!c.active) continue;
    const { y, m } = parseISO(from);
    for (let k = 0; k <= 13; k++) {
      const first = addMonths(clampDay(y, m, 1), k);
      const p = parseISO(first);
      const due = clampDay(p.y, p.m, c.dayOfMonth);
      if (due >= to) break;
      if (due < from) continue;
      const isPaid = paid.has(`${c.id}:${due}`);
      out.push({ commitment: c, dueDate: due, paid: isPaid, overdue: !isPaid && due < today });
    }
  }
  return out.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
}

export function goalSaved(goalId: string, data: Pick<AppData, 'goalContributions'>): number {
  return data.goalContributions.filter((c) => c.goalId === goalId).reduce((s, c) => s + c.amount, 0);
}

export function reservedForGoals(data: Pick<AppData, 'goals' | 'goalContributions'>): number {
  return data.goals.reduce((s, g) => s + Math.max(0, goalSaved(g.id, data)), 0);
}

export interface Availability {
  nextPay: ISODate | null;
  periodStart: ISODate | null;
  liquid: number;
  reservedGoals: number;
  /** true si las metas no se están restando del disponible (ajuste del usuario). */
  goalsExcluded: boolean;
  pendingCommitments: number;
  pending: CommitmentOccurrence[];
  available: number;
  /** Días que hay que cubrir: desde hoy hasta el día antes del pago. */
  daysLeft: number;
  /** Cuánto puedes gastar al día (0 si hay faltante). */
  perDay: number;
  /** Faltante si el disponible es negativo (positivo), si no 0. */
  shortfall: number;
}

export function availability(data: AppData, today: ISODate): Availability {
  const { liquid } = totals(data);
  const goalsExcluded = data.settings.goalsReduceAvailable === false;
  const reservedGoals = goalsExcluded ? 0 : reservedForGoals(data);
  const nextPay = nextPayDate(today, data.settings);
  if (!nextPay) {
    return {
      nextPay: null,
      periodStart: null,
      liquid,
      reservedGoals,
      goalsExcluded,
      pendingCommitments: 0,
      pending: [],
      available: liquid - reservedGoals,
      daysLeft: 0,
      perDay: 0,
      shortfall: Math.max(0, reservedGoals - liquid)
    };
  }
  const period = periodFor(today, data.settings.payDays.length ? data.settings.payDays : []);
  const periodStart = period.start <= today ? period.start : today;
  const occ = commitmentOccurrences(data, periodStart, nextPay, today);
  const pending = occ.filter((o) => !o.paid);
  const pendingCommitments = pending.reduce((s, o) => s + o.commitment.amount, 0);
  const available = liquid - reservedGoals - pendingCommitments;
  const daysLeft = Math.max(1, diffDays(today, nextPay));
  return {
    nextPay,
    periodStart,
    liquid,
    reservedGoals,
    goalsExcluded,
    pendingCommitments,
    pending,
    available,
    daysLeft,
    perDay: available > 0 ? Math.floor(available / daysLeft) : 0,
    shortfall: available < 0 ? -available : 0
  };
}

export interface GoalPlan {
  saved: number;
  remaining: number;
  progress: number; // 0..1
  periodsLeft: number;
  perPeriod: number;
  overdue: boolean;
}

/** Cuánto separar por quincena para llegar a la meta. */
export function goalPlan(goal: Goal, data: Pick<AppData, 'goalContributions' | 'settings'>, today: ISODate): GoalPlan {
  const saved = goalSaved(goal.id, data);
  const remaining = Math.max(0, goal.target - saved);
  const overdue = goal.deadline < today && remaining > 0;
  let periodsLeft: number;
  if (data.settings.payDays.length) {
    periodsLeft = payDatesAround(today, data.settings.payDays, 0, 60).filter(
      (d) => d > today && d <= goal.deadline
    ).length;
  } else {
    periodsLeft = Math.floor(diffDays(today, goal.deadline) / 15);
  }
  periodsLeft = Math.max(1, periodsLeft);
  return {
    saved,
    remaining,
    progress: goal.target > 0 ? Math.min(1, saved / goal.target) : 0,
    periodsLeft,
    perPeriod: Math.ceil(remaining / periodsLeft),
    overdue
  };
}

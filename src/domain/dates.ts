// Utilidades de fechas en America/Bogota.
// Trabajamos con strings 'YYYY-MM-DD' para no depender de la zona del dispositivo.
// Colombia no tiene horario de verano (UTC-5 todo el año), pero igual usamos Intl
// para que el cálculo sea correcto aunque el celular esté configurado en otra zona.

import type { ISODate } from './types';

export const TZ = 'America/Bogota';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Fecha financiera (Bogotá) de un instante. */
export function toBogotaDate(instant: number | Date = Date.now()): ISODate {
  return fmt.format(typeof instant === 'number' ? new Date(instant) : instant);
}

export function todayBogota(now: number = Date.now()): ISODate {
  return toBogotaDate(now);
}

export function parseISO(d: ISODate): { y: number; m: number; d: number } {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, d: day };
}

export function makeISO(y: number, m: number, d: number): ISODate {
  // Normaliza desbordes (p. ej. mes 13) usando UTC puro.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  const { y, m, d: day } = parseISO(d);
  return makeISO(y, m, day + n);
}

export function addMonths(d: ISODate, n: number): ISODate {
  const { y, m, d: day } = parseISO(d);
  return clampDay(y, m + n, day);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Día `day` del mes (y, m) recortado al último día si el mes es más corto. */
export function clampDay(y: number, m: number, day: number): ISODate {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const yy = first.getUTCFullYear();
  const mm = first.getUTCMonth() + 1;
  return makeISO(yy, mm, Math.min(day, daysInMonth(yy, mm)));
}

/** Días entre a y b (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

/** 0 = domingo ... 6 = sábado */
export function weekday(d: ISODate): number {
  const { y, m, d: day } = parseISO(d);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay();
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function formatShort(d: ISODate): string {
  const { m, d: day } = parseISO(d);
  return `${day} ${MESES[m - 1]}`;
}

export function formatHuman(d: ISODate, today: ISODate = todayBogota()): string {
  const diff = diffDays(today, d);
  if (diff === 0) return 'Hoy';
  if (diff === -1) return 'Ayer';
  if (diff === 1) return 'Mañana';
  return `${DIAS[weekday(d)]} ${formatShort(d)}`;
}

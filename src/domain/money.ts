// Formato de pesos colombianos. Los montos siempre son enteros.

const cop = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });

/** 18000 → "$18.000"; -5000 → "-$5.000" */
export function formatCOP(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? '-' : ''}$${cop.format(Math.abs(r))}`;
}

/** Versión compacta para gráficas: 1.250.000 → "$1,3 M", 18.000 → "$18 mil" */
export function formatCompact(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')} M`;
  if (a >= 1_000) return `${s}$${Math.round(a / 1000)} mil`;
  return formatCOP(n);
}

/** Convierte lo que el usuario escribe en un input de monto ("18.000", "18000") a entero. */
export function parseMoneyInput(s: string): number {
  const digits = s.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

export function toInt(n: number): number {
  return Math.round(n);
}

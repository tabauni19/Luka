/** minúsculas, sin tildes, sin signos, espacios simples. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ$., ]/g, ' ')
    .replace(/[.,](?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

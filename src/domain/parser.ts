// Analizador LOCAL de frases en español colombiano.
// Convierte "Hoy gasté 18 lucas en almuerzo con Bancolombia y 12 mil en transporte en efectivo"
// en dos BORRADORES editables. No usa internet ni IA.
//
// Pasos:
//   1. Normalizar (minúsculas, sin tildes).
//   2. Encontrar fechas ("hoy", "ayer", "el lunes", "el 5", "3 de noviembre") y taparlas
//      para que sus números no se confundan con montos.
//   3. Encontrar montos ("18 lucas", "12k", "12.500", "1,5 millones").
//   4. Partir la frase en un segmento por monto (cortando en " y ", comas, etc.).
//   5. En cada segmento: tipo (gasto/ingreso/transferencia), cuenta(s), descripción, categoría.
//   6. Marcar lo que sea ambiguo para que la persona lo aclare antes de guardar.

import { addDays, makeISO, parseISO, weekday } from './dates';
import { categorize } from './categories';
import { normalize, uid } from './text';
import type { Account, Category, CategoryRule, ISODate, TxKind } from './types';

export type DraftIssue =
  | { type: 'amount_missing' }
  | { type: 'amount_ambiguous'; options: number[] }
  | { type: 'account_missing' }
  | { type: 'account_ambiguous'; options: string[] }
  | { type: 'to_account_missing' };

export interface Draft {
  id: string;
  kind: TxKind;
  amount: number | null;
  date: ISODate;
  description: string;
  accountId: string | null;
  toAccountId?: string | null;
  categoryId?: string;
  /** La categoría vino de una regla aprendida. */
  learnedCategory?: boolean;
  /** Texto original del segmento (para mostrar de dónde salió). */
  sourceText: string;
  issues: DraftIssue[];
}

export interface ParseContext {
  accounts: Account[];
  categories: Category[];
  rules: CategoryRule[];
  today: ISODate;
}

// ---------- Montos ----------

const UNIT_MULT: Record<string, number> = {
  k: 1_000,
  mil: 1_000,
  luca: 1_000,
  lucas: 1_000,
  millon: 1_000_000,
  millones: 1_000_000,
  palo: 1_000_000,
  palos: 1_000_000,
  m: 1_000_000
};

const WORD_NUM: Record<string, string> = {
  un: '1', una: '1', uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7',
  ocho: '8', nueve: '9', diez: '10', quince: '15', veinte: '20', treinta: '30', cuarenta: '40',
  cincuenta: '50', cien: '100', medio: '0.5', media: '0.5'
};

const AMOUNT_RE = /\$?\s?(\d+(?:[.,]\d+)*)\s*(k|mil|lucas?|millones|millon|palos?|m)?(?![a-z0-9])/g;

export interface AmountMatch {
  start: number;
  end: number;
  value: number;
  /** true si no tenía unidad y es tan pequeño que probablemente quisiste decir miles. */
  ambiguous: boolean;
}

/** Convierte el texto numérico + unidad en pesos enteros. Exportada para pruebas. */
export function amountFromParts(num: string, unit?: string): { value: number; ambiguous: boolean } {
  const mult = unit ? UNIT_MULT[unit] : 1;
  let n: number;
  if (/^\d+[.,]\d{1,2}$/.test(num)) {
    // "1,5" o "12.5": decimal (con unidad tiene sentido: 1,5 millones)
    n = parseFloat(num.replace(',', '.'));
  } else {
    // "12.500", "1.200.000", "12,500": separadores de miles
    n = parseInt(num.replace(/[.,]/g, ''), 10);
  }
  const value = Math.round(n * mult);
  // "18" sin unidad casi siempre significa 18 mil en Colombia: pedimos confirmación.
  const ambiguous = !unit && value < 1000;
  return { value, ambiguous };
}

export function findAmounts(text: string): AmountMatch[] {
  const out: AmountMatch[] = [];
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(text))) {
    const { value, ambiguous } = amountFromParts(m[1], m[2]);
    if (value <= 0) continue;
    out.push({ start: m.index, end: m.index + m[0].length, value, ambiguous });
  }
  return out;
}

// ---------- Fechas ----------

const DIAS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

interface DateMatch {
  start: number;
  end: number;
  date: ISODate;
}

function findDates(text: string, today: ISODate): DateMatch[] {
  const out: DateMatch[] = [];
  const push = (re: RegExp, fn: (m: RegExpExecArray) => ISODate | null) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const d = fn(m);
      if (d) out.push({ start: m.index, end: m.index + m[0].length, date: d });
    }
  };
  const t = parseISO(today);

  push(/\b(antier|anteayer|antes de ayer)\b/g, () => addDays(today, -2));
  push(/\bayer\b/g, (m) => (/antes de\s*$/.test(text.slice(0, m.index)) ? null : addDays(today, -1)));
  push(/\bhoy\b/g, () => today);
  push(/\b(?:el )?(?:pasado )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)(?: pasado)?\b/g, (m) => {
    const target = DIAS[m[1]];
    let back = (weekday(today) - target + 7) % 7;
    if (/pasado/.test(m[0]) && back === 0) back = 7;
    return addDays(today, -back);
  });
  push(/\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/g, (m) => {
    const day = parseInt(m[1], 10);
    const month = MESES[m[2]];
    let d = makeISO(t.y, month, day);
    if (d > today) d = makeISO(t.y - 1, month, day);
    return d;
  });
  push(/\b(?:el|el dia|dia) (\d{1,2})\b(?! de [a-z]+\b)(?!\s*(?:k|mil|lucas?|millones|millon|palos?)\b)/g, (m) => {
    const day = parseInt(m[1], 10);
    if (day < 1 || day > 31) return null;
    let d = makeISO(t.y, t.m, day);
    if (d > today) d = makeISO(t.y, t.m - 1, day);
    return d;
  });
  // Quitar solapados (gana el más largo).
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const clean: DateMatch[] = [];
  for (const d of out) if (!clean.some((c) => d.start < c.end && d.end > c.start)) clean.push(d);
  return clean;
}

function blank(text: string, ranges: Array<{ start: number; end: number }>): string {
  let s = text;
  for (const r of ranges) s = s.slice(0, r.start) + ' '.repeat(r.end - r.start) + s.slice(r.end);
  return s;
}

// ---------- Cuentas ----------

const GENERIC = new Set(['tarjeta', 'cuenta', 'de', 'del', 'credito', 'debito', 'ahorros', 'corriente', 'la', 'el', 'mi', 'billetera']);

function accountAliases(a: Account): string[] {
  const n = normalize(a.name);
  const aliases = new Set<string>([n]);
  for (const w of n.split(' ')) if (w.length >= 2 && !GENERIC.has(w)) aliases.add(w);
  if (a.type === 'cash') ['efectivo', 'cash', 'billete', 'billetes'].forEach((x) => aliases.add(x));
  return [...aliases];
}

interface AccountHit {
  account: Account;
  pos: number;
  alias: string;
}

function findAccounts(seg: string, accounts: Account[]): AccountHit[] {
  const hits: AccountHit[] = [];
  const padded = ` ${seg} `;
  for (const a of accounts) {
    if (a.archived) continue;
    let best: AccountHit | null = null;
    for (const al of accountAliases(a)) {
      const i = padded.indexOf(` ${al} `);
      if (i >= 0 && (!best || al.length > best.alias.length)) best = { account: a, pos: i, alias: al };
    }
    if (best) hits.push(best);
  }
  // "tarjeta" sola: si hay exactamente una tarjeta de crédito, es esa.
  if (!hits.some((h) => h.account.type === 'credit') && / tarjeta /.test(padded)) {
    const credits = accounts.filter((a) => a.type === 'credit' && !a.archived);
    if (credits.length === 1) hits.push({ account: credits[0], pos: padded.indexOf(' tarjeta '), alias: 'tarjeta' });
  }
  return hits.sort((a, b) => a.pos - b.pos);
}

// ---------- Tipo de movimiento ----------

const INCOME_RE = /\b(me pagaron|me pago|recibi|me consignaron|me llego|me llegaron|ingreso|me entraron|me entro|gane|cobre|vendi|me transfirieron|me regalaron|me devolvieron|salario|sueldo|nomina)\b/;
const TRANSFER_RE = /\b(pase|transferi|movi|mande|envie|recargue|saque|retire|pasar|transferir)\b/;
const CARD_PAY_RE = /\b(pague|abone|pago|cancele|pagar|abonar)\b( de)?( la)?( tarjeta)?/;

// ---------- Segmentos ----------

const SEPARATORS = [' y ', ', ', ' , ', '; ', ' tambien ', ' luego ', ' despues ', ' ademas ', ' mas '];

function splitPoints(text: string, amounts: AmountMatch[]): number[] {
  const points: number[] = [];
  for (let i = 0; i < amounts.length - 1; i++) {
    const a = amounts[i].end;
    const b = amounts[i + 1].start;
    const between = text.slice(a, b);
    let cut = -1;
    for (const sep of SEPARATORS) {
      const k = between.lastIndexOf(sep);
      if (k > cut) cut = k;
    }
    points.push(cut >= 0 ? a + cut : b);
  }
  return points;
}

const FILLER =
  /\b(hoy|ayer|antier|anteayer|gaste|gastamos|gastaste|pague|compre|me gaste|meti|di|fueron|fue|pesos|peso|cop|plata|en total|me cobraron|pagamos|compramos|pase|transferi|movi|mande|envie|recargue|saque|retire|me pagaron|me pago|recibi|me consignaron|me llego|me llegaron|me entraron|me entro|gane|cobre|vendi|me transfirieron|me regalaron|me devolvieron|el|la|un|una|como|por ahi|aprox|aproximadamente)\b/g;

function cleanDescription(seg: string, hits: AccountHit[], amount?: AmountMatch, segOffset = 0): string {
  let s = seg;
  if (amount) s = blank(s, [{ start: amount.start - segOffset, end: amount.end - segOffset }]);
  for (const h of hits) {
    // quita "con X", "en X", "de X", "desde X", "a X", "por X", "X"
    s = ` ${s} `.replace(new RegExp(`\\s(?:con|en|de|desde|a|al|por|usando|con la|con el|en la|de la|a la)?\\s*(?:tarjeta\\s+)?${h.alias}\\s`, 'g'), ' ');
  }
  s = s.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  // quita preposiciones sueltas al inicio y al final
  for (let i = 0; i < 3; i++) s = s.replace(/^(en|de|del|para|por|con|y|a|al)\s+/, '').replace(/\s+(en|de|del|para|por|con|y|a|al)$/, '');
  s = s.trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export function parseSentence(input: string, ctx: ParseContext): Draft[] {
  const norm = normalize(input);
  if (!norm) return [];

  // "dos lucas" → "2 lucas", "medio palo" → "0.5 palo"
  const withNums = norm.replace(
    /\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|cuarenta|cincuenta|cien|medio|media)\s+(mil|lucas?|millones|millon|palos?)\b/g,
    (_m, w: string, u: string) => `${WORD_NUM[w]} ${u}`
  );

  const dates = findDates(withNums, ctx.today);
  const text = blank(withNums, dates);
  const amounts = findAmounts(text);

  const segments: Array<{ start: number; end: number; amount?: AmountMatch }> = [];
  if (!amounts.length) {
    segments.push({ start: 0, end: text.length });
  } else {
    const pts = splitPoints(text, amounts);
    let start = 0;
    amounts.forEach((a, i) => {
      const end = i < pts.length ? pts[i] : text.length;
      segments.push({ start, end, amount: a });
      start = end;
    });
  }

  // Fecha por segmento: la propia, si no la anterior, si no la primera de la frase, si no hoy.
  let carried: ISODate | undefined;
  const firstDate = dates[0]?.date;

  return segments.map((sg) => {
    const segText = text.slice(sg.start, sg.end);
    const own = dates.find((d) => d.start >= sg.start && d.start < sg.end);
    const date = own?.date ?? carried ?? firstDate ?? ctx.today;
    carried = date;

    const issues: DraftIssue[] = [];
    let amount: number | null = sg.amount ? sg.amount.value : null;
    if (!sg.amount) issues.push({ type: 'amount_missing' });
    else if (sg.amount.ambiguous) {
      issues.push({ type: 'amount_ambiguous', options: [sg.amount.value, sg.amount.value * 1000] });
      amount = null;
    }

    const hits = findAccounts(segText, ctx.accounts);
    const credit = hits.find((h) => h.account.type === 'credit');
    const nonCredit = hits.filter((h) => h.account.type !== 'credit');

    let kind: TxKind = 'expense';
    let accountId: string | null = null;
    let toAccountId: string | null | undefined;

    const cardPay = credit && CARD_PAY_RE.exec(segText);
    const isCardPayment =
      !!credit && !!cardPay && (/tarjeta/.test(cardPay[0]) || new RegExp(`\\b(pague|abone|pago|cancele)( a)?( la)? ${credit.alias}\\b`).test(segText) || new RegExp(`\\ba ${credit.alias}\\b`).test(segText));

    if (INCOME_RE.test(segText) && !TRANSFER_RE.test(segText)) {
      kind = 'income';
    } else if (isCardPayment || (TRANSFER_RE.test(segText) && hits.length >= 2)) {
      kind = 'transfer';
    } else if (TRANSFER_RE.test(segText) && hits.length === 1) {
      kind = 'transfer';
    }

    if (kind === 'transfer') {
      let from: AccountHit | undefined;
      let to: AccountHit | undefined;
      if (isCardPayment && credit) {
        to = credit;
        from = nonCredit[0];
      } else {
        for (const h of hits) {
          const before = ` ${segText} `.slice(0, h.pos + 1);
          if (/\s(a|al|hacia|para)\s(la\s)?$/.test(before) && !to) to = h;
          else if (!from) from = h;
          else if (!to) to = h;
        }
      }
      accountId = from?.account.id ?? null;
      toAccountId = to?.account.id ?? null;
      if (!accountId) issues.push({ type: 'account_missing' });
      if (!toAccountId) issues.push({ type: 'to_account_missing' });
    } else {
      const uniq = [...new Set(hits.map((h) => h.account.id))];
      if (uniq.length === 1) accountId = uniq[0];
      else if (uniq.length > 1) issues.push({ type: 'account_ambiguous', options: uniq });
      else {
        const active = ctx.accounts.filter((a) => !a.archived && (kind === 'expense' || a.type !== 'credit'));
        if (active.length === 1) accountId = active[0].id;
        else issues.push({ type: 'account_missing' });
      }
    }

    const description = cleanDescription(segText, hits, sg.amount, sg.start) || (kind === 'transfer' ? (isCardPayment ? 'Pago de tarjeta' : 'Transferencia') : '');
    let categoryId: string | undefined;
    let learned = false;
    if (kind !== 'transfer') {
      const c = categorize(description || segText, kind, ctx.rules, ctx.categories);
      categoryId = c.categoryId;
      learned = c.learned;
    }

    return {
      id: uid(),
      kind,
      amount,
      date,
      description: description || (kind === 'income' ? 'Ingreso' : 'Gasto'),
      accountId,
      toAccountId,
      categoryId,
      learnedCategory: learned,
      sourceText: withNums.slice(sg.start, sg.end).trim().replace(/[\s,;]+(y|tambien|luego|despues|ademas|mas)?$/, '').replace(/^(y|tambien|luego|despues|ademas|mas)\s+/, ''),
      issues
    };
  });
}

/** Un borrador está listo cuando no le falta nada necesario. */
export function draftReady(d: Draft): boolean {
  if (!d.amount || d.amount <= 0) return false;
  if (!d.accountId) return false;
  if (d.kind === 'transfer' && (!d.toAccountId || d.toAccountId === d.accountId)) return false;
  return true;
}

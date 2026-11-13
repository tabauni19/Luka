// Procesa las compras detectadas en notificaciones Android (Google Wallet / bancos).
// El módulo nativo (Kotlin) ya extrajo los campos y los dejó en una cola persistente;
// aquí decidimos qué hacer con cada uno al abrir la app:
//
//   rechazada                          → se descarta (JAMÁS cuenta como gasto)
//   falta monto / moneda / cuenta      → "Por revisar" (no toca saldos)
//   mismo monto ±10 min de otra fuente
//      y misma tarjeta o comercio      → es el mismo pago: se ignora el segundo aviso
//      sin evidencia suficiente        → "Por revisar" como posible duplicado
//   todo claro                         → se guarda solo, etiquetado, y se puede deshacer

import { categorize } from './categories';
import { toBogotaDate } from './dates';
import { normalize } from './text';
import type { AppData, CardLink, ReviewItem, Transaction } from './types';

export const WALLET_PACKAGE = 'com.google.android.apps.walletnfcrel';

/** Fuentes conocidas. Los nombres de paquete de bancos deben verificarse en el celular. */
export const KNOWN_SOURCES: Array<{ pkg: string; label: string; wallet?: boolean }> = [
  { pkg: WALLET_PACKAGE, label: 'Google Wallet', wallet: true },
  { pkg: 'com.todo1.mobile', label: 'Bancolombia' },
  { pkg: 'com.nu.production', label: 'Nu' },
  { pkg: 'com.lulobank.app', label: 'Lulo Bank' },
  { pkg: 'com.nequi.MobileApp', label: 'Nequi' },
  { pkg: 'com.davivienda.daviviendaapp', label: 'Davivienda' }
];

export function sourceLabel(pkg: string): string {
  return KNOWN_SOURCES.find((s) => s.pkg === pkg)?.label ?? pkg;
}

/** Lo que entrega el módulo nativo por cada notificación relevante. Solo datos del movimiento. */
export interface CapturedEvent {
  id: string; // hash estable de la notificación (paquete + key + hora)
  app: string; // paquete Android
  postedAt: number; // epoch ms
  amount?: number; // pesos enteros
  currency?: string; // 'COP', 'USD', ...
  merchant?: string;
  cardLast4?: string;
  declined: boolean;
}

export interface CaptureResult {
  transactions: Transaction[];
  reviewItems: ReviewItem[];
  newCardLinks: CardLink[];
  processed: string[];
  ignored: Array<{ id: string; reason: 'rechazada' | 'fuente_no_habilitada' | 'duplicado' | 'ya_procesada' }>;
}

const WINDOW_MS = 10 * 60 * 1000;

function merchantMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const fa = na.split(' ')[0];
  const fb = nb.split(' ')[0];
  return fa.length >= 4 && fa === fb;
}

export function findCardLink(links: CardLink[], app: string, last4?: string): CardLink | undefined {
  return (last4 && links.find((l) => l.app === app && l.last4 === last4)) || links.find((l) => l.app === app && !l.last4);
}

interface Candidate {
  amount: number;
  at: number;
  app: string;
  last4?: string;
  merchant?: string;
  txId?: string;
  date: string;
  manual: boolean;
}

export function processCaptures(events: CapturedEvent[], data: AppData, now = Date.now()): CaptureResult {
  const res: CaptureResult = { transactions: [], reviewItems: [], newCardLinks: [], processed: [], ignored: [] };
  const done = new Set(data.processedCaptures);
  const enabled = new Set(data.settings.autoCapture.sources);
  const links = [...data.cardLinks];

  // Compras ya conocidas contra las que comparar duplicados.
  const candidates: Candidate[] = [];
  for (const t of data.transactions) {
    if (t.kind !== 'expense') continue;
    if (t.capture) {
      candidates.push({ amount: t.amount, at: t.createdAt, app: t.capture.app, last4: t.capture.cardLast4, merchant: t.capture.merchant, txId: t.id, date: t.date, manual: false });
    } else {
      candidates.push({ amount: t.amount, at: t.createdAt, app: 'manual', merchant: t.description, txId: t.id, date: t.date, manual: true });
    }
  }
  for (const r of data.reviewItems) {
    if (r.amount) candidates.push({ amount: r.amount, at: r.postedAt, app: r.app, last4: r.cardLast4, merchant: r.merchant, date: r.date, manual: false });
  }

  const sorted = [...events].sort((a, b) => a.postedAt - b.postedAt);
  for (const e of sorted) {
    if (done.has(e.id)) {
      res.ignored.push({ id: e.id, reason: 'ya_procesada' });
      continue;
    }
    done.add(e.id);
    res.processed.push(e.id);

    if (!enabled.has(e.app)) {
      res.ignored.push({ id: e.id, reason: 'fuente_no_habilitada' });
      continue;
    }
    if (e.declined) {
      res.ignored.push({ id: e.id, reason: 'rechazada' });
      continue;
    }

    const date = toBogotaDate(e.postedAt);
    const amount = e.amount && e.amount > 0 ? Math.round(e.amount) : undefined;

    // Vincular tarjeta → cuenta. Si es nueva, se crea el vínculo vacío para que la persona lo complete.
    let link = findCardLink(links, e.app, e.cardLast4);
    if (!link) {
      link = {
        id: `${e.app}:${e.cardLast4 ?? '*'}`,
        app: e.app,
        last4: e.cardLast4,
        label: `${sourceLabel(e.app)}${e.cardLast4 ? ` •••• ${e.cardLast4}` : ''}`
      };
      links.push(link);
      res.newCardLinks.push(link);
    }
    const accountId = link.accountId && data.accounts.some((a) => a.id === link!.accountId && !a.archived) ? link.accountId : undefined;
    const cat = e.merchant ? categorize(e.merchant, 'expense', data.rules, data.categories).categoryId : undefined;

    const review = (reason: ReviewItem['reason'], duplicateOfTxId?: string) =>
      res.reviewItems.push({
        id: e.id, captureId: e.id, app: e.app, amount, currency: e.currency, merchant: e.merchant, cardLast4: e.cardLast4,
        date, postedAt: e.postedAt, reason, duplicateOfTxId, suggestedCategoryId: cat, suggestedAccountId: accountId, createdAt: now
      });

    // Duplicados: mismo monto en ±10 min desde OTRA fuente (o un registro manual del mismo día).
    if (amount) {
      const near = candidates.filter(
        (c) => c.amount === amount && (c.manual ? c.date === date : Math.abs(c.at - e.postedAt) <= WINDOW_MS && c.app !== e.app)
      );
      if (near.length) {
        const same = near.find((c) => !c.manual && ((c.last4 && e.cardLast4 && c.last4 === e.cardLast4) || merchantMatch(c.merchant, e.merchant)));
        if (same) {
          res.ignored.push({ id: e.id, reason: 'duplicado' });
          continue;
        }
        review('posible_duplicado', near[0].txId);
        candidates.push({ amount, at: e.postedAt, app: e.app, last4: e.cardLast4, merchant: e.merchant, date, manual: false });
        continue;
      }
    }

    if (!amount) review('falta_monto');
    else if (!e.currency) review('falta_moneda');
    else if (e.currency !== 'COP') review('moneda_extranjera');
    else if (!accountId) review('falta_cuenta');
    else {
      const t: Transaction = {
        id: `cap:${e.id}`,
        kind: 'expense',
        amount,
        date,
        description: e.merchant || `Compra ${sourceLabel(e.app)}`,
        accountId,
        categoryId: cat ?? 'otros',
        source: e.app === WALLET_PACKAGE ? 'google_wallet' : 'banco',
        capture: { captureId: e.id, merchant: e.merchant, cardLast4: e.cardLast4, app: e.app },
        createdAt: e.postedAt,
        updatedAt: now
      };
      res.transactions.push(t);
      candidates.push({ amount, at: e.postedAt, app: e.app, last4: e.cardLast4, merchant: e.merchant, txId: t.id, date, manual: false });
      continue;
    }
    if (amount) candidates.push({ amount, at: e.postedAt, app: e.app, last4: e.cardLast4, merchant: e.merchant, date, manual: false });
  }
  return res;
}

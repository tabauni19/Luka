// Persistencia en IndexedDB (con la librería `idb`).
// Cada colección es un object store con `id` como llave. La app carga todo en memoria
// (son pocos datos) y después de cada cambio vuelve a leer, así lo que ves siempre es
// exactamente lo que quedó guardado.

import { openDB, type IDBPDatabase } from 'idb';
import { DEFAULT_CATEGORIES, ruleKey } from '../domain/categories';
import type { Draft } from '../domain/parser';
import { draftReady } from '../domain/parser';
import { uid } from '../domain/text';
import { WALLET_PACKAGE, type CaptureResult } from '../domain/capture';
import {
  DEFAULT_SETTINGS,
  type Account,
  type AppData,
  type CardLink,
  type Category,
  type CategoryRule,
  type Commitment,
  type CommitmentPayment,
  type Goal,
  type GoalContribution,
  type ISODate,
  type ReviewItem,
  type Settings,
  type Transaction,
  type TxSource
} from '../domain/types';

export const COLLECTIONS = [
  'accounts',
  'transactions',
  'categories',
  'rules',
  'commitments',
  'commitmentPayments',
  'goals',
  'goalContributions',
  'cardLinks',
  'reviewItems'
] as const;
type Collection = (typeof COLLECTIONS)[number];

const DB_VERSION = 1;

export class Repo {
  private constructor(private db: IDBPDatabase) {}

  static async open(name = 'luka'): Promise<Repo> {
    const db = await openDB(name, DB_VERSION, {
      upgrade(db) {
        for (const c of COLLECTIONS) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('captures')) db.createObjectStore('captures');
      }
    });
    const repo = new Repo(db);
    if ((await db.count('categories')) === 0) {
      const tx = db.transaction('categories', 'readwrite');
      await Promise.all([...DEFAULT_CATEGORIES.map((c) => tx.store.put(c)), tx.done]);
    }
    return repo;
  }

  close() {
    this.db.close();
  }

  async load(): Promise<AppData> {
    const [accounts, transactions, categories, rules, commitments, commitmentPayments, goals, goalContributions, cardLinks, reviewItems] =
      await Promise.all(COLLECTIONS.map((c) => this.db.getAll(c)));
    const settings = { ...DEFAULT_SETTINGS, ...((await this.db.get('kv', 'settings')) as Partial<Settings> | undefined) };
    const processedCaptures = (await this.db.getAllKeys('captures')) as string[];
    return {
      accounts: (accounts as Account[]).sort((a, b) => a.createdAt - b.createdAt),
      transactions: transactions as Transaction[],
      categories: categories as Category[],
      rules: rules as CategoryRule[],
      commitments: commitments as Commitment[],
      commitmentPayments: commitmentPayments as CommitmentPayment[],
      goals: (goals as Goal[]).sort((a, b) => a.createdAt - b.createdAt),
      goalContributions: goalContributions as GoalContribution[],
      cardLinks: cardLinks as CardLink[],
      reviewItems: reviewItems as ReviewItem[],
      processedCaptures,
      settings
    };
  }

  // ---------- genéricos ----------
  put<T extends { id: string }>(c: Collection, v: T) {
    return this.db.put(c, v);
  }
  delete(c: Collection, id: string) {
    return this.db.delete(c, id);
  }
  get<T>(c: Collection, id: string): Promise<T | undefined> {
    return this.db.get(c, id);
  }

  async saveSettings(patch: Partial<Settings>) {
    const cur = { ...DEFAULT_SETTINGS, ...((await this.db.get('kv', 'settings')) ?? {}) };
    await this.db.put('kv', { ...cur, ...patch }, 'settings');
  }

  // ---------- movimientos ----------

  /**
   * Guarda borradores como movimientos. Es IDEMPOTENTE: el id del movimiento es el id
   * del borrador, así que guardar dos veces el mismo borrador sobrescribe en vez de duplicar.
   * Si cambiaste la categoría sugerida, se recuerda para descripciones parecidas.
   */
  async saveDrafts(drafts: Draft[], source: TxSource, suggested: Record<string, string | undefined> = {}) {
    const now = Date.now();
    const ready = drafts.filter(draftReady);
    const tx = this.db.transaction(['transactions', 'rules'], 'readwrite');
    const ts = tx.objectStore('transactions');
    for (const d of ready) {
      const existing = (await ts.get(d.id)) as Transaction | undefined;
      const t: Transaction = {
        id: d.id,
        kind: d.kind,
        amount: Math.round(d.amount!),
        date: d.date,
        description: d.description.trim() || 'Movimiento',
        accountId: d.accountId!,
        toAccountId: d.kind === 'transfer' ? d.toAccountId ?? undefined : undefined,
        categoryId: d.kind === 'transfer' ? undefined : d.categoryId,
        source,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };
      await ts.put(t);
      const sug = suggested[d.id];
      if (d.kind !== 'transfer' && d.categoryId && sug !== undefined && sug !== d.categoryId) {
        await this.learnRuleIn(tx.objectStore('rules'), d.description, d.categoryId);
      }
    }
    await tx.done;
    return ready.length;
  }

  private async learnRuleIn(store: { put: (v: CategoryRule) => Promise<unknown>; getAll: () => Promise<unknown[]> }, description: string, categoryId: string) {
    const key = ruleKey(description);
    if (!key) return;
    const all = (await store.getAll()) as CategoryRule[];
    const ex = all.find((r) => r.key === key);
    await store.put({ id: ex?.id ?? uid(), key, categoryId, createdAt: Date.now() });
  }

  async learnRule(description: string, categoryId: string) {
    const tx = this.db.transaction('rules', 'readwrite');
    await this.learnRuleIn(tx.store, description, categoryId);
    await tx.done;
  }

  async putTransaction(t: Transaction) {
    await this.db.put('transactions', { ...t, amount: Math.round(t.amount), updatedAt: Date.now() });
  }

  /** Borra un movimiento. Si era el pago de un compromiso, el compromiso vuelve a quedar pendiente. */
  async deleteTransaction(id: string) {
    const tx = this.db.transaction(['transactions', 'commitmentPayments'], 'readwrite');
    await tx.objectStore('transactions').delete(id);
    const pays = (await tx.objectStore('commitmentPayments').getAll()) as CommitmentPayment[];
    for (const p of pays) if (p.txId === id) await tx.objectStore('commitmentPayments').delete(p.id);
    await tx.done;
  }

  // ---------- cuentas ----------
  async deleteAccount(id: string): Promise<'deleted' | 'archived'> {
    const all = (await this.db.getAll('transactions')) as Transaction[];
    if (all.some((t) => t.accountId === id || t.toAccountId === id)) {
      const a = (await this.db.get('accounts', id)) as Account;
      await this.db.put('accounts', { ...a, archived: true });
      return 'archived';
    }
    await this.db.delete('accounts', id);
    return 'deleted';
  }

  // ---------- compromisos ----------

  /**
   * Marca la ocurrencia (compromiso + fecha) como pagada y registra el movimiento.
   * Idempotente: el pago y el movimiento tienen ids derivados de la ocurrencia.
   */
  async payCommitment(c: Commitment, dueDate: ISODate, accountId: string, payDate: ISODate) {
    const payId = `${c.id}:${dueDate}`;
    const txId = `pay:${payId}`;
    const tx = this.db.transaction(['transactions', 'commitmentPayments'], 'readwrite');
    if (await tx.objectStore('commitmentPayments').get(payId)) {
      await tx.done;
      return;
    }
    const now = Date.now();
    const isCard = !!c.cardAccountId;
    const t: Transaction = {
      id: txId,
      kind: isCard ? 'transfer' : 'expense',
      amount: c.amount,
      date: payDate,
      description: c.name,
      accountId,
      toAccountId: isCard ? c.cardAccountId : undefined,
      categoryId: isCard ? undefined : c.categoryId ?? 'hogar',
      source: 'compromiso',
      commitmentId: c.id,
      demo: c.demo,
      createdAt: now,
      updatedAt: now
    };
    await tx.objectStore('transactions').put(t);
    await tx.objectStore('commitmentPayments').put({ id: payId, commitmentId: c.id, dueDate, txId, paidAt: now, demo: c.demo });
    await tx.done;
  }

  /** "Ya lo había pagado": la ocurrencia deja de estar pendiente SIN crear movimiento (no toca saldos). */
  async settleCommitment(c: Commitment, dueDate: ISODate) {
    const payId = `${c.id}:${dueDate}`;
    if (await this.db.get('commitmentPayments', payId)) return;
    await this.db.put('commitmentPayments', { id: payId, commitmentId: c.id, dueDate, txId: `settled:${payId}`, paidAt: Date.now(), demo: c.demo });
  }

  async unpayCommitment(commitmentId: string, dueDate: ISODate) {
    const payId = `${commitmentId}:${dueDate}`;
    const p = (await this.db.get('commitmentPayments', payId)) as CommitmentPayment | undefined;
    if (!p) return;
    await this.deleteTransaction(p.txId);
  }

  // ---------- capturas automáticas ----------
  /** Aplica en UNA transacción lo que decidió processCaptures (todo o nada). */
  async applyCaptureResult(r: CaptureResult) {
    const tx = this.db.transaction(['transactions', 'reviewItems', 'cardLinks', 'captures'], 'readwrite');
    for (const t of r.transactions) await tx.objectStore('transactions').put(t);
    for (const i of r.reviewItems) await tx.objectStore('reviewItems').put(i);
    for (const l of r.newCardLinks) await tx.objectStore('cardLinks').put(l);
    for (const id of r.processed) await tx.objectStore('captures').put(Date.now(), id);
    await tx.done;
  }

  /** Confirma un "Por revisar": recién ahí se crea el movimiento y cambian los saldos. */
  async confirmReview(item: ReviewItem, t: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt' | 'source' | 'capture'>) {
    const now = Date.now();
    const tx = this.db.transaction(['transactions', 'reviewItems'], 'readwrite');
    await tx.objectStore('transactions').put({
      ...t,
      id: `cap:${item.captureId}`,
      amount: Math.round(t.amount),
      source: item.app === WALLET_PACKAGE ? 'google_wallet' : 'banco',
      capture: { captureId: item.captureId, merchant: item.merchant, cardLast4: item.cardLast4, app: item.app },
      createdAt: item.postedAt,
      updatedAt: now
    } satisfies Transaction);
    await tx.objectStore('reviewItems').delete(item.id);
    await tx.done;
  }

  // ---------- respaldo ----------
  async exportAll(): Promise<object> {
    const data = await this.load();
    return { app: 'luka', version: 1, exportedAt: new Date().toISOString(), data };
  }

  /** Reemplaza TODO con el respaldo (después de validarlo). */
  async importAll(raw: unknown) {
    const data = validateBackup(raw);
    await this.wipe();
    const tx = this.db.transaction([...COLLECTIONS, 'kv', 'captures'], 'readwrite');
    for (const c of COLLECTIONS) for (const v of data[c] as Array<{ id: string }>) await tx.objectStore(c).put(v);
    await tx.objectStore('kv').put(data.settings, 'settings');
    for (const id of data.processedCaptures) await tx.objectStore('captures').put(Date.now(), id);
    await tx.done;
  }

  async wipe() {
    const tx = this.db.transaction([...COLLECTIONS, 'kv', 'captures'], 'readwrite');
    for (const c of COLLECTIONS) await tx.objectStore(c).clear();
    await tx.objectStore('kv').clear();
    await tx.objectStore('captures').clear();
    await tx.done;
    const t2 = this.db.transaction('categories', 'readwrite');
    for (const c of DEFAULT_CATEGORIES) await t2.store.put(c);
    await t2.done;
  }

  /** Borra todo lo marcado como demo de una sola vez. */
  async clearDemo() {
    const tx = this.db.transaction([...COLLECTIONS], 'readwrite');
    for (const c of COLLECTIONS) {
      const all = (await tx.objectStore(c).getAll()) as Array<{ id: string; demo?: boolean }>;
      for (const v of all) if (v.demo) await tx.objectStore(c).delete(v.id);
    }
    await tx.done;
    const s = (await this.load()).settings;
    await this.saveSettings({ demoMode: false, ...(s.demoPayDays ? { payDays: [], demoPayDays: false } : {}) });
  }

  async bulkPut(items: Partial<{ [K in Collection]: AppData[K] }>) {
    const names = Object.keys(items) as Collection[];
    const tx = this.db.transaction(names, 'readwrite');
    for (const n of names) for (const v of items[n] as Array<{ id: string }>) await tx.objectStore(n).put(v);
    await tx.done;
  }
}

export function validateBackup(raw: unknown): AppData {
  const r = raw as { app?: string; data?: Partial<AppData> };
  if (!r || typeof r !== 'object' || r.app !== 'luka' || !r.data) throw new Error('El archivo no es un respaldo de Luka.');
  const d = r.data;
  for (const c of COLLECTIONS) {
    if (!Array.isArray(d[c])) throw new Error(`Respaldo incompleto: falta "${c}".`);
    for (const v of d[c] as unknown[]) if (!v || typeof (v as { id?: unknown }).id !== 'string') throw new Error(`Registro inválido en "${c}".`);
  }
  for (const t of d.transactions as Transaction[]) {
    if (!Number.isInteger(t.amount) || t.amount <= 0) throw new Error('Hay un movimiento con monto inválido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error('Hay un movimiento con fecha inválida.');
    if (!['expense', 'income', 'transfer'].includes(t.kind)) throw new Error('Hay un movimiento con tipo inválido.');
  }
  return {
    ...(d as AppData),
    processedCaptures: Array.isArray(d.processedCaptures) ? d.processedCaptures : [],
    settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) }
  };
}

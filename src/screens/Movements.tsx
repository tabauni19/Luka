// Movimientos: filtros por quincena/cuenta/categoría, gráfica por categoría y lista.

import { useMemo, useState } from 'react';
import { recentPeriods } from '../domain/budget';
import { sourceLabel } from '../domain/capture';
import { formatHuman } from '../domain/dates';
import { expensesByCategory, sortTxs } from '../domain/ledger';
import { formatCompact } from '../domain/money';
import type { Transaction } from '../domain/types';
import { useApp } from '../state';
import { AccountSelect, AmountInput, CategorySelect, confirmAsk, Empty, Field, Icon, Money, Segmented, Sheet } from '../ui/kit';

const SOURCE_BADGE: Record<string, string> = { google_wallet: 'Google Wallet', banco: 'Notificación banco', voz: 'Dictado', compromiso: 'Compromiso' };

export function TxRow({ t, onClick, perspective }: { t: Transaction; onClick: () => void; perspective?: string }) {
  const { data, today } = useApp();
  const cat = data.categories.find((c) => c.id === t.categoryId);
  const acc = data.accounts.find((a) => a.id === t.accountId);
  const to = data.accounts.find((a) => a.id === t.toAccountId);
  const isCardPay = t.kind === 'transfer' && to?.type === 'credit';
  let sign = t.kind === 'income' ? 1 : t.kind === 'expense' ? -1 : 0;
  if (perspective && t.kind === 'transfer') sign = t.toAccountId === perspective ? 1 : -1;
  return (
    <li>
      <button className="tx" onClick={onClick}>
        <span className="tx-ico" style={{ background: t.kind === 'transfer' ? 'var(--chip)' : `${cat?.color ?? '#8D99AE'}22` }}>
          {t.kind === 'transfer' ? <Icon name="swap" size={18} /> : cat?.emoji ?? '🧾'}
        </span>
        <span className="tx-main">
          <span className="tx-desc">{t.description}</span>
          <span className="tx-meta">
            {formatHuman(t.date, today)} · {t.kind === 'transfer' ? `${acc?.name ?? '?'} → ${to?.name ?? '?'}` : acc?.name ?? 'Cuenta borrada'}
            {isCardPay && ' · pago de tarjeta'}
            {SOURCE_BADGE[t.source] && <span className={`badge ${t.source}`}>{SOURCE_BADGE[t.source]}</span>}
          </span>
        </span>
        <Money value={sign * t.amount} signed className={sign > 0 ? 'pos' : sign < 0 ? '' : 'neutral'} />
      </button>
    </li>
  );
}

export function TxEditSheet({ txId, onClose }: { txId: string; onClose: () => void }) {
  const { data, mutate, toast, repo } = useApp();
  const orig = data.transactions.find((t) => t.id === txId);
  const [t, setT] = useState<Transaction | undefined>(orig);
  if (!orig || !t) return null;
  const valid = t.amount > 0 && !!t.accountId && (t.kind !== 'transfer' || (!!t.toAccountId && t.toAccountId !== t.accountId));
  const captured = !!orig.capture;

  const save = async () => {
    await mutate(async (r) => {
      await r.putTransaction(t);
      if (t.categoryId && t.categoryId !== orig.categoryId && t.kind !== 'transfer') await r.learnRule(t.description, t.categoryId);
    });
    toast('Movimiento actualizado');
    onClose();
  };
  const remove = async () => {
    if (!confirmAsk(captured ? '¿Deshacer este registro automático? El saldo vuelve a como estaba.' : '¿Eliminar este movimiento?')) return;
    const backup = orig;
    await mutate((r) => r.deleteTransaction(orig.id));
    toast(captured ? 'Registro automático deshecho' : 'Movimiento eliminado', { label: 'Recuperar', run: () => mutate(() => repo.putTransaction(backup)) });
    onClose();
  };

  return (
    <Sheet
      title={captured ? `Registrado desde ${sourceLabel(orig.capture!.app)}` : 'Editar movimiento'}
      onClose={onClose}
      footer={
        <div className="row gap">
          <button className="btn ghost danger" onClick={remove}>
            <Icon name={captured ? 'undo' : 'trash'} size={16} /> {captured ? 'Deshacer' : 'Eliminar'}
          </button>
          <button className="btn primary grow" disabled={!valid} onClick={save}>Guardar cambios</button>
        </div>
      }
    >
      {orig.commitmentId && <p className="muted small">Es el pago de un compromiso. Si lo eliminas, el compromiso vuelve a quedar pendiente.</p>}
      <Segmented
        label="Tipo"
        value={t.kind}
        onChange={(k) => setT({ ...t, kind: k, categoryId: k === 'transfer' ? undefined : k === 'income' ? 'otros_ingresos' : t.categoryId ?? 'otros', toAccountId: k === 'transfer' ? t.toAccountId : undefined })}
        options={[{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Ingreso' }, { value: 'transfer', label: 'Transferencia' }]}
      />
      <Field label="Monto"><AmountInput value={t.amount} onChange={(v) => setT({ ...t, amount: v ?? 0 })} invalid={!t.amount} /></Field>
      <Field label="Descripción"><input value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} /></Field>
      <div className="grid2">
        <Field label="Fecha"><input type="date" value={t.date} onChange={(e) => e.target.value && setT({ ...t, date: e.target.value })} /></Field>
        {t.kind !== 'transfer' && (
          <Field label="Categoría"><CategorySelect categories={data.categories} kind={t.kind} value={t.categoryId} onChange={(id) => setT({ ...t, categoryId: id })} /></Field>
        )}
      </div>
      <div className={t.kind === 'transfer' ? 'grid2' : ''}>
        <Field label={t.kind === 'transfer' ? 'Desde' : 'Cuenta'}><AccountSelect accounts={data.accounts} value={t.accountId} onChange={(id) => setT({ ...t, accountId: id })} /></Field>
        {t.kind === 'transfer' && <Field label="Hacia"><AccountSelect accounts={data.accounts} exclude={t.accountId} value={t.toAccountId} onChange={(id) => setT({ ...t, toAccountId: id })} /></Field>}
      </div>
      {captured && (
        <p className="muted small">
          Detectado en una notificación{orig.capture?.merchant ? ` de «${orig.capture.merchant}»` : ''}{orig.capture?.cardLast4 ? ` con la tarjeta •••• ${orig.capture.cardLast4}` : ''}.
        </p>
      )}
    </Sheet>
  );
}

/** Gráfica de barras horizontal: gasto por categoría. Tocar una barra filtra la lista. */
export function CategoryBars({ txs, onPick, selected }: { txs: Transaction[]; onPick: (id: string | null) => void; selected: string | null }) {
  const { data } = useApp();
  const rows = useMemo(() => {
    const m = expensesByCategory(txs);
    return [...m.entries()].map(([id, v]) => ({ id, v, c: data.categories.find((c) => c.id === id) })).sort((a, b) => b.v - a.v);
  }, [txs, data.categories]);
  const max = rows[0]?.v ?? 0;
  const total = rows.reduce((s, r) => s + r.v, 0);
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="row between">
        <h3 className="card-title">Gastos por categoría</h3>
        <Money value={total} className="strong" />
      </div>
      <ul className="bars">
        {rows.map((r) => (
          <li key={r.id}>
            <button className={`bar-row ${selected === r.id ? 'on' : ''} ${selected && selected !== r.id ? 'dim' : ''}`} onClick={() => onPick(selected === r.id ? null : r.id)} aria-pressed={selected === r.id}>
              <span className="bar-label">{r.c?.emoji ?? '🧾'} {r.c?.name ?? 'Sin categoría'}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${(r.v / max) * 100}%`, background: r.c?.color ?? '#8D99AE' }} /></span>
              <span className="bar-val">{formatCompact(r.v)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted small">Toca una categoría para ver los movimientos que suman ese total.</p>
    </div>
  );
}

export function MovementsScreen({ onEditTx, onOpenRegister, onOpenReview, initialCategory }: { onEditTx: (id: string) => void; onOpenRegister: () => void; onOpenReview: () => void; initialCategory?: string | null }) {
  const { data, today } = useApp();
  const periods = useMemo(() => recentPeriods(today, data.settings.payDays, 8), [today, data.settings.payDays]);
  const [periodIdx, setPeriodIdx] = useState<number>(0); // -1 = todo
  const [accountId, setAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string | null>(initialCategory ?? null);

  const inPeriod = useMemo(() => {
    const p = periodIdx >= 0 ? periods[periodIdx] : null;
    return data.transactions.filter((t) => (!p || (t.date >= p.start && t.date < p.end)) && (!accountId || t.accountId === accountId || t.toAccountId === accountId));
  }, [data.transactions, periods, periodIdx, accountId]);
  const list = useMemo(() => sortTxs(inPeriod.filter((t) => !categoryId || (t.kind === 'expense' && (t.categoryId ?? 'sin_categoria') === categoryId))), [inPeriod, categoryId]);

  // agrupar por día
  const groups = useMemo(() => {
    const g: Array<{ date: string; items: Transaction[] }> = [];
    for (const t of list) {
      const last = g[g.length - 1];
      if (last && last.date === t.date) last.items.push(t);
      else g.push({ date: t.date, items: [t] });
    }
    return g;
  }, [list]);

  if (!data.transactions.length)
    return (
      <div className="screen">
        <h1 className="screen-title">Movimientos</h1>
        {data.reviewItems.length > 0 && <ReviewBanner onOpen={onOpenReview} />}
        <Empty icon="list" title="Todavía no hay movimientos" text="Escribe o dicta una frase como «12 mil en transporte en efectivo»." action={<button className="btn primary" onClick={onOpenRegister}>Registrar el primero</button>} />
      </div>
    );

  const catName = categoryId ? data.categories.find((c) => c.id === categoryId) : null;

  return (
    <div className="screen">
      <h1 className="screen-title">Movimientos</h1>
      {data.reviewItems.length > 0 && <ReviewBanner onOpen={onOpenReview} />}
      <div className="filters">
        <select value={periodIdx} onChange={(e) => setPeriodIdx(Number(e.target.value))} aria-label="Quincena">
          {periods.map((p, i) => <option key={p.start} value={i}>{i === 0 ? `Esta quincena (${p.label})` : p.label}</option>)}
          <option value={-1}>Todo</option>
        </select>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Cuenta">
          <option value="">Todas las cuentas</option>
          {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>)}
        </select>
        <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {data.categories.filter((c) => c.kind === 'expense').map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
        </select>
      </div>

      <CategoryBars txs={inPeriod} selected={categoryId} onPick={setCategoryId} />

      {catName && (
        <div className="filter-pill">
          Mostrando solo {catName.emoji} {catName.name}: <Money value={list.reduce((s, t) => s + t.amount, 0)} className="strong" />
          <button className="icon-btn small" onClick={() => setCategoryId(null)} aria-label="Quitar filtro"><Icon name="close" size={16} /></button>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="muted center pad">No hay movimientos con estos filtros.</p>
      ) : (
        groups.map((g) => (
          <section key={g.date}>
            <h4 className="day">{formatHuman(g.date, today)}</h4>
            <ul className="tx-list">
              {g.items.map((t) => <TxRow key={t.id} t={t} onClick={() => onEditTx(t.id)} />)}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ReviewBanner({ onOpen }: { onOpen: () => void }) {
  const { data } = useApp();
  return (
    <button className="review-banner" onClick={onOpen}>
      <Icon name="bell" size={18} />
      <span><b>{data.reviewItems.length}</b> {data.reviewItems.length === 1 ? 'compra detectada por revisar' : 'compras detectadas por revisar'}</span>
      <Icon name="chev" size={18} />
    </button>
  );
}
export { ReviewBanner };

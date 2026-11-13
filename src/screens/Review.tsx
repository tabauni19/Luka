// "Por revisar": compras detectadas en notificaciones a las que les falta algo.
// No tocan ningún saldo hasta que las confirmes.

import { useState } from 'react';
import { sourceLabel } from '../domain/capture';
import { formatHuman } from '../domain/dates';
import type { ReviewItem } from '../domain/types';
import { useApp } from '../state';
import { AccountSelect, AmountInput, CategorySelect, Field, Sheet } from '../ui/kit';

const REASON: Record<ReviewItem['reason'], string> = {
  falta_monto: 'La notificación no traía el monto.',
  falta_moneda: 'No se pudo saber la moneda.',
  moneda_extranjera: 'La compra no fue en pesos. Escribe cuánto te cobraron en COP.',
  falta_cuenta: 'No sé a qué cuenta corresponde esta tarjeta.',
  posible_duplicado: 'Puede ser el mismo pago que ya está registrado (mismo monto y hora).'
};

function ReviewCard({ item }: { item: ReviewItem }) {
  const { data, mutate, toast, today } = useApp();
  const [amount, setAmount] = useState<number | null>(item.currency === 'COP' || !item.currency ? item.amount ?? null : null);
  const [accountId, setAccountId] = useState<string | undefined>(item.suggestedAccountId);
  const [categoryId, setCategoryId] = useState(item.suggestedCategoryId ?? 'otros');
  const [remember, setRemember] = useState(item.reason === 'falta_cuenta');
  const dup = item.duplicateOfTxId ? data.transactions.find((t) => t.id === item.duplicateOfTxId) : undefined;

  const confirm = async () => {
    if (!amount || !accountId) return;
    await mutate(async (r) => {
      await r.confirmReview(item, { kind: 'expense', amount, date: item.date, description: item.merchant || `Compra ${sourceLabel(item.app)}`, accountId, categoryId });
      if (remember) {
        const id = `${item.app}:${item.cardLast4 ?? '*'}`;
        const ex = data.cardLinks.find((l) => l.id === id);
        await r.put('cardLinks', { id, app: item.app, last4: item.cardLast4, label: ex?.label ?? `${sourceLabel(item.app)}${item.cardLast4 ? ` •••• ${item.cardLast4}` : ''}`, accountId });
      }
    });
    toast('Compra registrada');
  };
  const discard = async () => {
    await mutate((r) => r.delete('reviewItems', item.id));
    toast(item.reason === 'posible_duplicado' ? 'Descartado: era el mismo pago' : 'Descartado');
  };

  return (
    <div className="draft needs">
      <div className="row between">
        <b>{item.merchant || 'Compra sin comercio'}</b>
        <span className="badge">{sourceLabel(item.app)}</span>
      </div>
      <p className="muted small">
        {formatHuman(item.date, today)}
        {item.cardLast4 ? ` · tarjeta •••• ${item.cardLast4}` : ''}
        {item.amount && item.currency && item.currency !== 'COP' ? ` · ${item.amount} ${item.currency}` : ''}
      </p>
      <p className="warn-line">{REASON[item.reason]}</p>
      {dup && (
        <p className="muted small">
          Ya registrado: «{dup.description}» por ${dup.amount.toLocaleString('es-CO')} ({formatHuman(dup.date, today)}).
        </p>
      )}
      <div className="grid2">
        <Field label="Monto (COP)"><AmountInput value={amount} onChange={setAmount} invalid={!amount} /></Field>
        <Field label="Categoría"><CategorySelect categories={data.categories} kind="expense" value={categoryId} onChange={setCategoryId} /></Field>
      </div>
      <Field label="Cuenta"><AccountSelect accounts={data.accounts} value={accountId} onChange={setAccountId} invalid={!accountId} /></Field>
      {item.reason === 'falta_cuenta' && (
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Usar esta cuenta siempre para {item.cardLast4 ? `•••• ${item.cardLast4}` : sourceLabel(item.app)}
        </label>
      )}
      <div className="row gap">
        <button className="btn ghost" onClick={discard}>{item.reason === 'posible_duplicado' ? 'Es el mismo, descartar' : 'Descartar'}</button>
        <button className="btn primary grow" disabled={!amount || !accountId} onClick={confirm}>{item.reason === 'posible_duplicado' ? 'Es otra compra, registrar' : 'Registrar'}</button>
      </div>
    </div>
  );
}

export function ReviewSheet({ onClose }: { onClose: () => void }) {
  const { data } = useApp();
  return (
    <Sheet title="Por revisar" onClose={onClose}>
      {data.reviewItems.length === 0 ? (
        <p className="muted">Todo al día. Nada por revisar.</p>
      ) : (
        [...data.reviewItems].sort((a, b) => b.postedAt - a.postedAt).map((i) => <ReviewCard key={i.id} item={i} />)
      )}
    </Sheet>
  );
}

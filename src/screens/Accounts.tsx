// Cuentas: crear/editar y ver el detalle con sus movimientos.

import { useState } from 'react';
import { accountBalances, sortTxs } from '../domain/ledger';
import { uid } from '../domain/text';
import type { Account, AccountType } from '../domain/types';
import { useApp } from '../state';
import { AmountInput, confirmAsk, Field, Icon, Money, Sheet } from '../ui/kit';
import { TxRow } from './Movements';

const TYPES: Array<{ value: AccountType; label: string }> = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'bank', label: 'Cuenta bancaria' },
  { value: 'wallet', label: 'Billetera digital (Nequi, Daviplata…)' },
  { value: 'credit', label: 'Tarjeta de crédito' }
];
const COLORS = ['#0E7C66', '#F2B544', '#FDDA24', '#820AD1', '#C6F432', '#E4002B', '#3D85C6', '#EF476F', '#8D99AE'];
const SUGGESTIONS: Array<Pick<Account, 'name' | 'type' | 'color'>> = [
  { name: 'Efectivo', type: 'cash', color: '#F2B544' },
  { name: 'Bancolombia', type: 'bank', color: '#FDDA24' },
  { name: 'Nu', type: 'credit', color: '#820AD1' },
  { name: 'Lulo', type: 'bank', color: '#C6F432' },
  { name: 'Nequi', type: 'wallet', color: '#E4007C' }
];

export function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { data, mutate, toast } = useApp();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'bank');
  const [initial, setInitial] = useState<number | null>(account?.initialBalance ?? null);
  const [limit, setLimit] = useState<number | null>(account?.creditLimit ?? null);
  const [color, setColor] = useState(account?.color ?? COLORS[0]);
  const isCredit = type === 'credit';
  const existingNames = new Set(data.accounts.filter((a) => a.id !== account?.id && !a.archived).map((a) => a.name.toLowerCase()));
  const valid = name.trim().length > 0 && !existingNames.has(name.trim().toLowerCase());

  const save = async () => {
    if (!valid) return;
    const a: Account = {
      id: account?.id ?? uid(),
      name: name.trim(),
      type,
      initialBalance: initial ?? 0,
      creditLimit: isCredit ? limit ?? undefined : undefined,
      color,
      demo: account?.demo,
      createdAt: account?.createdAt ?? Date.now()
    };
    await mutate((r) => r.put('accounts', a));
    toast(account ? 'Cuenta actualizada' : `Cuenta «${a.name}» creada`);
    onClose();
  };

  return (
    <Sheet title={account ? 'Editar cuenta' : 'Nueva cuenta'} onClose={onClose} footer={<button className="btn primary block" disabled={!valid} onClick={save}>Guardar</button>}>
      {!account && (
        <div className="chips">
          {SUGGESTIONS.filter((s) => !existingNames.has(s.name.toLowerCase())).map((s) => (
            <button key={s.name} className={`chip ${name === s.name ? 'on' : ''}`} onClick={() => { setName(s.name); setType(s.type); setColor(s.color); }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <Field label="Nombre">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Bancolombia" autoFocus={!account} />
      </Field>
      {name.trim() && !valid && <p className="warn-line">Ya tienes una cuenta con ese nombre.</p>}
      <Field label="Tipo">
        <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label={isCredit ? 'Deuda actual de la tarjeta' : 'Saldo inicial'} hint={isCredit ? 'Lo que debes hoy. Las compras la suben; los pagos la bajan.' : 'Lo que hay hoy en la cuenta.'}>
        <AmountInput value={initial} onChange={setInitial} />
      </Field>
      {isCredit && (
        <Field label="Cupo (opcional)">
          <AmountInput value={limit} onChange={setLimit} />
        </Field>
      )}
      <Field label="Color">
        <div className="colors">
          {COLORS.map((c) => (
            <button key={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />
          ))}
        </div>
      </Field>
    </Sheet>
  );
}

export function AccountDetail({ accountId, onClose, onEditTx }: { accountId: string; onClose: () => void; onEditTx: (id: string) => void }) {
  const { data, mutate, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const a = data.accounts.find((x) => x.id === accountId);
  if (!a) return null;
  const bal = accountBalances(data.accounts, data.transactions).get(a.id) ?? 0;
  const txs = sortTxs(data.transactions.filter((t) => t.accountId === a.id || t.toAccountId === a.id));

  const remove = async () => {
    if (!confirmAsk(`¿Eliminar «${a.name}»? Si tiene movimientos, se archiva para no dañar tus totales.`)) return;
    const box = { res: 'deleted' as 'deleted' | 'archived' };
    await mutate(async (r) => { box.res = await r.deleteAccount(a.id); });
    toast(box.res === 'archived' ? 'Cuenta archivada (tenía movimientos)' : 'Cuenta eliminada');
    onClose();
  };

  if (editing) return <AccountForm account={a} onClose={() => setEditing(false)} />;

  return (
    <Sheet title={a.name} onClose={onClose}>
      <div className="acc-hero" style={{ ['--acc' as string]: a.color }}>
        <span className="muted">{a.type === 'credit' ? 'Deuda actual' : 'Saldo'}</span>
        <Money value={bal} className="big" />
        {a.type === 'credit' && a.creditLimit ? <span className="muted small">Cupo disponible: <Money value={a.creditLimit - bal} /></span> : null}
        <div className="row gap">
          <button className="btn ghost" onClick={() => setEditing(true)}>Editar</button>
          <button className="btn ghost danger" onClick={remove}><Icon name="trash" size={16} /> Eliminar</button>
        </div>
      </div>
      <h3 className="section-title">Movimientos</h3>
      {txs.length === 0 ? (
        <p className="muted">Aún no hay movimientos en esta cuenta.</p>
      ) : (
        <ul className="tx-list">
          {txs.map((t) => <TxRow key={t.id} t={t} perspective={a.id} onClick={() => onEditTx(t.id)} />)}
        </ul>
      )}
    </Sheet>
  );
}

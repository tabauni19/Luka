// Presupuesto: fechas de pago, topes por categoría (quincena) y compromisos recurrentes.

import { useState } from 'react';
import { availability, commitmentOccurrences, periodFor, type CommitmentOccurrence } from '../domain/budget';
import { formatHuman, formatShort } from '../domain/dates';
import { expensesByCategory } from '../domain/ledger';
import { uid } from '../domain/text';
import type { Category, Commitment } from '../domain/types';
import { useApp } from '../state';
import { AccountSelect, AmountInput, CategorySelect, confirmAsk, Field, Icon, Money, Progress, Sheet } from '../ui/kit';
import { PayCommitmentSheet } from './Home';

function PayDaysEditor() {
  const { data, mutate, toast, today } = useApp();
  const s = data.settings;
  const [mode, setMode] = useState<'quincenal' | 'mensual' | 'manual'>(s.payDays.length === 2 ? 'quincenal' : s.payDays.length === 1 ? 'mensual' : s.nextPayDateOverride ? 'manual' : 'quincenal');
  const [d1, setD1] = useState(s.payDays[0] ?? 15);
  const [d2, setD2] = useState(s.payDays[1] ?? 30);
  const [manual, setManual] = useState(s.nextPayDateOverride ?? '');

  const save = async () => {
    const payDays = mode === 'quincenal' ? [d1, d2].sort((a, b) => a - b) : mode === 'mensual' ? [d1] : [];
    await mutate((r) => r.saveSettings({ payDays, demoPayDays: false, nextPayDateOverride: mode === 'manual' ? manual : undefined }));
    toast('Fechas de pago guardadas');
  };
  const dayInput = (v: number, set: (n: number) => void, label: string) => (
    <Field label={label}>
      <input type="number" min={1} max={31} value={v} onChange={(e) => set(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} />
    </Field>
  );
  const valid = mode !== 'manual' || manual > today;

  return (
    <section className="card">
      <h3 className="card-title"><Icon name="calendar" size={18} /> ¿Cuándo te pagan?</h3>
      <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Frecuencia de pago">
        <option value="quincenal">Dos veces al mes (quincena)</option>
        <option value="mensual">Una vez al mes</option>
        <option value="manual">Solo la próxima fecha</option>
      </select>
      {mode === 'quincenal' && <div className="grid2">{dayInput(d1, setD1, 'Primer pago (día)')}{dayInput(d2, setD2, 'Segundo pago (día)')}</div>}
      {mode === 'mensual' && dayInput(d1, setD1, 'Día de pago')}
      {mode === 'manual' && (
        <Field label="Próximo pago"><input type="date" min={today} value={manual} onChange={(e) => setManual(e.target.value)} /></Field>
      )}
      <p className="muted small">Si el mes es más corto (p. ej. 30 en febrero), uso el último día del mes.</p>
      <button className="btn primary" disabled={!valid} onClick={save}>Guardar</button>
    </section>
  );
}

function LimitEditor({ c, onClose }: { c: Category; onClose: () => void }) {
  const { mutate, toast } = useApp();
  const [v, setV] = useState<number | null>(c.biweeklyLimit || null);
  const hide = async () => {
    await mutate((r) => r.put('categories', { ...c, hidden: true, biweeklyLimit: 0 }));
    toast(`«${c.name}» oculta`, { label: 'Deshacer', run: () => mutate((r) => r.put('categories', c)) });
    onClose();
  };
  return (
    <Sheet title={`${c.emoji} ${c.name}`} onClose={onClose} footer={
      <div className="col gap">
        <button className="btn primary block" onClick={async () => { await mutate((r) => r.put('categories', { ...c, biweeklyLimit: v ?? 0 })); onClose(); }}>Guardar</button>
        {c.biweeklyLimit > 0 && (
          <button className="btn ghost danger block" onClick={async () => {
            await mutate((r) => r.put('categories', { ...c, biweeklyLimit: 0 }));
            toast(`Tope de ${c.name} eliminado`, { label: 'Deshacer', run: () => mutate((r) => r.put('categories', c)) });
            onClose();
          }}><Icon name="trash" size={16} /> Quitar tope</button>
        )}
        <button className="btn ghost block" onClick={hide}><Icon name="eyeOff" size={16} /> Ocultar categoría (no la uso)</button>
      </div>
    }>
      <Field label="Tope máximo por quincena" hint="Déjalo vacío para no tener tope."><AmountInput value={v} onChange={setV} autoFocus /></Field>
    </Sheet>
  );
}

function CommitmentForm({ c, onClose }: { c?: Commitment; onClose: () => void }) {
  const { data, mutate, toast } = useApp();
  const [name, setName] = useState(c?.name ?? '');
  const [amount, setAmount] = useState<number | null>(c?.amount ?? null);
  const [day, setDay] = useState(c?.dayOfMonth ?? 1);
  const [twice, setTwice] = useState(!!c?.secondDay);
  const [day2, setDay2] = useState(c?.secondDay ?? 30);
  const [isCard, setIsCard] = useState(!!c?.cardAccountId);
  const [card, setCard] = useState(c?.cardAccountId);
  const [accountId, setAccountId] = useState(c?.accountId);
  const [categoryId, setCategoryId] = useState(c?.categoryId ?? 'hogar');
  const hasCards = data.accounts.some((a) => a.type === 'credit' && !a.archived);
  const valid = name.trim() && amount && amount > 0 && (!isCard || card);

  const save = async () => {
    if (!valid) return;
    const v: Commitment = { id: c?.id ?? uid(), name: name.trim(), amount: amount!, dayOfMonth: day, secondDay: twice && day2 !== day ? day2 : undefined, categoryId: isCard ? undefined : categoryId, accountId, cardAccountId: isCard ? card : undefined, active: true, demo: c?.demo, createdAt: c?.createdAt ?? Date.now() };
    await mutate((r) => r.put('commitments', v));
    toast(c ? 'Compromiso actualizado' : 'Compromiso agregado');
    onClose();
  };
  const remove = async () => {
    if (!c || !confirmAsk(`¿Eliminar «${c.name}»? Los pagos ya registrados se conservan.`)) return;
    await mutate((r) => r.delete('commitments', c.id));
    onClose();
  };
  return (
    <Sheet title={c ? 'Editar compromiso' : 'Nuevo compromiso'} onClose={onClose} footer={<div className="row gap">{c && <button className="btn ghost danger" onClick={remove}><Icon name="trash" size={16} /></button>}<button className="btn primary grow" disabled={!valid} onClick={save}>Guardar</button></div>}>
      <Field label="Nombre"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Arriendo, plan del celular, gym…" autoFocus={!c} /></Field>
      <Field label={twice ? 'Monto de cada pago' : 'Monto'}><AmountInput value={amount} onChange={setAmount} /></Field>
      <Field label="¿Cada cuánto?">
        <select value={twice ? '2' : '1'} onChange={(e) => setTwice(e.target.value === '2')}>
          <option value="1">Una vez al mes</option>
          <option value="2">Dos veces al mes (quincenal)</option>
        </select>
      </Field>
      <div className={twice ? 'grid2' : ''}>
        <Field label={twice ? 'Primer día' : 'Día del mes'}><input type="number" min={1} max={31} value={day} onChange={(e) => setDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} /></Field>
        {twice && <Field label="Segundo día"><input type="number" min={1} max={31} value={day2} onChange={(e) => setDay2(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} /></Field>}
      </div>
      {twice && data.settings.payDays.length === 2 && (day !== data.settings.payDays[0] || day2 !== data.settings.payDays[1]) && (
        <button className="link" onClick={() => { setDay(data.settings.payDays[0]); setDay2(data.settings.payDays[1]); }}>Usar mis días de pago ({data.settings.payDays.join(' y ')})</button>
      )}
      {hasCards && (
        <label className="check"><input type="checkbox" checked={isCard} onChange={(e) => setIsCard(e.target.checked)} /> Es el pago de una tarjeta de crédito</label>
      )}
      {isCard ? (
        <Field label="Tarjeta" hint="Al pagarlo se registra una transferencia: baja la deuda, no suma a gastos."><AccountSelect accounts={data.accounts} value={card} onChange={setCard} filter={(a) => a.type === 'credit'} /></Field>
      ) : (
        <Field label="Categoría"><CategorySelect categories={data.categories} kind="expense" value={categoryId} onChange={setCategoryId} /></Field>
      )}
      <Field label="Cuenta con la que pagas (opcional)"><AccountSelect accounts={data.accounts} value={accountId} onChange={setAccountId} filter={(a) => a.type !== 'credit' || !isCard} placeholder="Elegir al pagar" /></Field>
    </Sheet>
  );
}

export function BudgetScreen({ onPickCategory }: { onPickCategory: (id: string) => void }) {
  const { data, today, mutate, toast } = useApp();
  const [limitCat, setLimitCat] = useState<Category | null>(null);
  const [editC, setEditC] = useState<Commitment | 'new' | null>(null);
  const [paying, setPaying] = useState<CommitmentOccurrence | null>(null);
  const period = periodFor(today, data.settings.payDays);
  const spent = expensesByCategory(data.transactions, period.start, period.end);
  const av = availability(data, today);
  const occ = commitmentOccurrences(data, period.start, av.nextPay && av.nextPay > period.end ? av.nextPay : period.end, today);
  const allCats = data.categories.filter((c) => c.kind === 'expense');
  const hiddenCats = allCats.filter((c) => c.hidden);
  // Una oculta sigue saliendo si tiene gastos en esta quincena, para que el total cuadre.
  const cats = allCats.filter((c) => !c.hidden || (spent.get(c.id) ?? 0) > 0);
  const limited = cats.filter((c) => c.biweeklyLimit > 0);
  const totalLimit = limited.reduce((s, c) => s + c.biweeklyLimit, 0);
  const totalSpentLimited = limited.reduce((s, c) => s + (spent.get(c.id) ?? 0), 0);

  return (
    <div className="screen">
      <h1 className="screen-title">Presupuesto</h1>
      <p className="muted">Quincena actual: <b>{period.label}</b></p>

      <PayDaysEditor />

      <section className="card">
        <div className="row between">
          <h3 className="card-title">Compromisos de la quincena</h3>
          <button className="link" onClick={() => setEditC('new')}>+ Agregar</button>
        </div>
        {data.commitments.length === 0 ? (
          <p className="muted small">Agrega arriendo, servicios, plan del celular o el pago de tu tarjeta. Se descuentan del disponible hasta que los marques como pagados.</p>
        ) : occ.length === 0 ? (
          <p className="muted small">Ningún compromiso vence en esta quincena.</p>
        ) : (
          <ul className="commit-list">
            {occ.map((o) => (
              <li key={`${o.commitment.id}:${o.dueDate}`} className={o.paid ? 'paid' : ''}>
                <span className={`due ${o.overdue ? 'late' : ''}`}>{o.paid ? 'Pagado' : o.overdue ? 'Vencido' : formatHuman(o.dueDate, today)}</span>
                <button className="grow link-plain" onClick={() => setEditC(o.commitment)}>{o.commitment.name}</button>
                <Money value={o.commitment.amount} />
                {o.paid ? (
                  <button className="btn tiny ghost" onClick={async () => { await mutate((r) => r.unpayCommitment(o.commitment.id, o.dueDate)); toast('Marcado como pendiente'); }}>Deshacer</button>
                ) : (
                  <button className="btn tiny" onClick={() => setPaying(o)}>Pagar</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {data.commitments.length > 0 && (
          <details className="all-commits">
            <summary>Todos los compromisos ({data.commitments.length})</summary>
            <ul className="plain-list">
              {data.commitments.map((c) => (
                <li key={c.id}><button className="link-plain row between full" onClick={() => setEditC(c)}><span>{c.name} · {c.secondDay ? `días ${c.dayOfMonth} y ${c.secondDay}` : `día ${c.dayOfMonth}`}</span><Money value={c.amount} /></button></li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h3 className="card-title">Topes por categoría</h3>
          {totalLimit > 0 && <span className="muted small"><Money value={totalSpentLimited} /> de <Money value={totalLimit} /></span>}
        </div>
        <p className="muted small">Toca el monto para poner un tope u ocultar la categoría; toca el nombre para ver sus movimientos.</p>
        <ul className="limits">
          {cats.map((c) => {
            const s = spent.get(c.id) ?? 0;
            const ratio = c.biweeklyLimit ? s / c.biweeklyLimit : 0;
            return (
              <li key={c.id}>
                <div className="row between">
                  <button className="link-plain" onClick={() => onPickCategory(c.id)}>{c.emoji} {c.name}</button>
                  <button className="link-plain small" onClick={() => setLimitCat(c)}>
                    <Money value={s} />{c.biweeklyLimit ? <> / <Money value={c.biweeklyLimit} /></> : <span className="muted"> · sin tope</span>}
                  </button>
                </div>
                {c.biweeklyLimit > 0 && <Progress value={ratio} tone={ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warn' : 'brand'} />}
                {c.biweeklyLimit > 0 && ratio >= 1 && <p className="warn-line small">Te pasaste por <Money value={s - c.biweeklyLimit} /></p>}
              </li>
            );
          })}
        </ul>
        {hiddenCats.length > 0 && (
          <details className="all-commits">
            <summary>Categorías ocultas ({hiddenCats.length})</summary>
            <ul className="plain-list">
              {hiddenCats.map((c) => (
                <li key={c.id} className="row between">
                  <span>{c.emoji} {c.name}</span>
                  <button className="btn tiny" onClick={async () => { await mutate((r) => r.put('categories', { ...c, hidden: undefined })); toast(`«${c.name}» visible otra vez`); }}>Mostrar</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {av.nextPay && <p className="muted small center">Próximo pago: {formatShort(av.nextPay)}</p>}

      {limitCat && <LimitEditor c={limitCat} onClose={() => setLimitCat(null)} />}
      {editC && <CommitmentForm c={editC === 'new' ? undefined : editC} onClose={() => setEditC(null)} />}
      {paying && <PayCommitmentSheet occ={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

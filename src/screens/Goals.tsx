// Metas: objetivo, fecha, aportes, progreso y cuánto separar por quincena.
// "Separar" no mueve plata entre cuentas: la aparta del disponible para que no la gastes.

import { useState } from 'react';
import { goalPlan } from '../domain/budget';
import { addMonths, formatShort } from '../domain/dates';
import { uid } from '../domain/text';
import type { Goal } from '../domain/types';
import { useApp } from '../state';
import { AmountInput, confirmAsk, Empty, Field, Icon, Money, Progress, Segmented, Sheet } from '../ui/kit';

const EMOJIS = ['✈️', '📱', '💻', '🏍️', '🎓', '🏠', '🎸', '💪', '🎁', '🛟'];

function GoalForm({ goal, onClose }: { goal?: Goal; onClose: () => void }) {
  const { mutate, today, toast } = useApp();
  const [name, setName] = useState(goal?.name ?? '');
  const [emoji, setEmoji] = useState(goal?.emoji ?? EMOJIS[0]);
  const [target, setTarget] = useState<number | null>(goal?.target ?? null);
  const [deadline, setDeadline] = useState(goal?.deadline ?? addMonths(today, 6));
  const valid = name.trim() && target && target > 0 && deadline > today;
  const save = async () => {
    if (!valid) return;
    await mutate((r) => r.put('goals', { id: goal?.id ?? uid(), name: name.trim(), emoji, target: target!, deadline, demo: goal?.demo, createdAt: goal?.createdAt ?? Date.now() }));
    toast(goal ? 'Meta actualizada' : 'Meta creada');
    onClose();
  };
  const remove = async () => {
    if (!goal || !confirmAsk(`¿Eliminar la meta «${goal.name}»? Lo separado vuelve a tu disponible.`)) return;
    await mutate(async (r) => {
      const d = await r.load();
      for (const c of d.goalContributions.filter((c) => c.goalId === goal.id)) await r.delete('goalContributions', c.id);
      await r.delete('goals', goal.id);
    });
    onClose();
  };
  return (
    <Sheet title={goal ? 'Editar meta' : 'Nueva meta'} onClose={onClose} footer={<div className="row gap">{goal && <button className="btn ghost danger" onClick={remove}><Icon name="trash" size={16} /></button>}<button className="btn primary grow" disabled={!valid} onClick={save}>Guardar</button></div>}>
      <div className="chips">{EMOJIS.map((e) => <button key={e} className={`chip emoji ${e === emoji ? 'on' : ''}`} onClick={() => setEmoji(e)} aria-label={`Ícono ${e}`}>{e}</button>)}</div>
      <Field label="¿Para qué ahorras?"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Viaje, celular nuevo…" autoFocus={!goal} /></Field>
      <div className="grid2">
        <Field label="Meta"><AmountInput value={target} onChange={setTarget} /></Field>
        <Field label="Fecha límite"><input type="date" min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

function ContributionSheet({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { data, mutate, today, toast } = useApp();
  const p = goalPlan(goal, data, today);
  const [mode, setMode] = useState<'add' | 'take'>('add');
  const [amount, setAmount] = useState<number | null>(p.perPeriod || null);
  const valid = !!amount && amount > 0 && (mode === 'add' || amount <= p.saved);
  const save = async () => {
    if (!valid) return;
    await mutate((r) => r.put('goalContributions', { id: uid(), goalId: goal.id, amount: mode === 'add' ? amount! : -amount!, date: today }));
    toast(mode === 'add' ? 'Aporte guardado' : 'Plata liberada');
    onClose();
  };
  const history = data.goalContributions.filter((c) => c.goalId === goal.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  return (
    <Sheet title={`${goal.emoji} ${goal.name}`} onClose={onClose} footer={<button className="btn primary block" disabled={!valid} onClick={save}>{mode === 'add' ? 'Separar' : 'Liberar'}</button>}>
      <Segmented label="Acción" value={mode} onChange={setMode} options={[{ value: 'add', label: 'Separar plata' }, { value: 'take', label: 'Liberar plata' }]} />
      <Field label="Monto" hint={mode === 'add' ? `Sugerido por quincena: $${p.perPeriod.toLocaleString('es-CO')}` : `Separado: $${p.saved.toLocaleString('es-CO')}`}><AmountInput value={amount} onChange={setAmount} /></Field>
      <p className="muted small">Separar no mueve plata entre cuentas: la descuenta de tu disponible para que no la gastes sin querer.</p>
      {history.length > 0 && (
        <>
          <h4 className="section-title">Historial</h4>
          <ul className="plain-list">
            {history.map((c) => (
              <li key={c.id} className="row between">
                <span>{formatShort(c.date)}</span>
                <span className="row gap"><Money value={c.amount} signed className={c.amount > 0 ? 'pos' : ''} />
                  <button className="icon-btn small" aria-label="Eliminar aporte" onClick={() => mutate((r) => r.delete('goalContributions', c.id))}><Icon name="trash" size={14} /></button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}

export function GoalsScreen() {
  const { data, today } = useApp();
  const [edit, setEdit] = useState<Goal | 'new' | null>(null);
  const [contrib, setContrib] = useState<Goal | null>(null);
  const totalPer = data.goals.reduce((s, g) => s + goalPlan(g, data, today).perPeriod, 0);

  return (
    <div className="screen">
      <div className="row between">
        <h1 className="screen-title">Metas</h1>
        {data.goals.length > 0 && <button className="btn tiny" onClick={() => setEdit('new')}><Icon name="plus" size={16} /> Nueva</button>}
      </div>
      {data.goals.length === 0 ? (
        <Empty icon="flag" title="Sin metas todavía" text="Crea una meta, como un viaje o un celular, y te digo cuánto separar cada quincena." action={<button className="btn primary" onClick={() => setEdit('new')}>Crear meta</button>} />
      ) : (
        <>
          <p className="muted">Para ir al día en todas, separa <b><Money value={totalPer} /></b> por quincena.</p>
          {data.goals.map((g) => {
            const p = goalPlan(g, data, today);
            return (
              <section key={g.id} className="card goal">
                <div className="row between">
                  <button className="link-plain goal-name" onClick={() => setEdit(g)}>{g.emoji} {g.name}</button>
                  <span className="muted small">hasta {formatShort(g.deadline)}</span>
                </div>
                <div className="row between baseline">
                  <Money value={p.saved} className="big" />
                  <span className="muted">de <Money value={g.target} /></span>
                </div>
                <Progress value={p.progress} />
                <p className="small">
                  {p.remaining === 0 ? '¡Meta cumplida! 🎉' : p.overdue ? <>La fecha ya pasó. Faltan <Money value={p.remaining} />.</> : <>Separa <b><Money value={p.perPeriod} /></b> por quincena ({p.periodsLeft} {p.periodsLeft === 1 ? 'quincena' : 'quincenas'}).</>}
                </p>
                <button className="btn ghost block" onClick={() => setContrib(g)}>Aportar o liberar</button>
              </section>
            );
          })}
        </>
      )}
      {edit && <GoalForm goal={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {contrib && <ContributionSheet goal={contrib} onClose={() => setContrib(null)} />}
    </div>
  );
}

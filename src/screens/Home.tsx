// Inicio: responde en segundos ¿cuánto tengo?, ¿cuánto me queda libre?, ¿cómo van mis metas?

import { useState } from 'react';
import { availability, goalPlan } from '../domain/budget';
import { formatHuman, formatShort } from '../domain/dates';
import { accountBalances, sortTxs, totals } from '../domain/ledger';
import type { CommitmentOccurrence } from '../domain/budget';
import { useApp } from '../state';
import { AccountSelect, Empty, Field, Icon, Money, Progress, Sheet } from '../ui/kit';
import { TxRow, ReviewBanner } from './Movements';

export function PayCommitmentSheet({ occ, onClose }: { occ: CommitmentOccurrence; onClose: () => void }) {
  const { data, mutate, toast, today } = useApp();
  const c = occ.commitment;
  const [accountId, setAccountId] = useState<string | undefined>(c.accountId && data.accounts.some((a) => a.id === c.accountId && !a.archived) ? c.accountId : undefined);
  const pay = async () => {
    if (!accountId) return;
    await mutate((r) => r.payCommitment(c, occ.dueDate, accountId, today));
    toast(`«${c.name}» marcado como pagado`, { label: 'Deshacer', run: () => mutate((r) => r.unpayCommitment(c.id, occ.dueDate)) });
    onClose();
  };
  return (
    <Sheet
      title={`Pagar ${c.name}`}
      onClose={onClose}
      footer={
        <div className="col gap">
          <button className="btn primary block" disabled={!accountId} onClick={pay}>Pagar ahora</button>
          {occ.dueDate <= today && (
            <button className="btn ghost block" onClick={async () => {
              await mutate((r) => r.settleCommitment(c, occ.dueDate));
              toast('Marcado como ya pagado (no cambia tus saldos)', { label: 'Deshacer', run: () => mutate((r) => r.unpayCommitment(c.id, occ.dueDate)) });
              onClose();
            }}>Ya lo había pagado antes</button>
          )}
        </div>
      }
    >
      <p>
        <Money value={c.amount} className="strong" /> · vence {formatHuman(occ.dueDate, today).toLowerCase()}
      </p>
      <p className="muted small">
        {c.cardAccountId ? 'Se registra como pago de tarjeta (transferencia): baja la deuda y no suma a tus gastos.' : 'Se registra el gasto y deja de contarse como pendiente: se descuenta una sola vez.'}
      </p>
      {occ.dueDate <= today && <p className="muted small">Si ya lo pagaste antes de usar Luka (y tus saldos ya lo reflejan), toca «Ya lo había pagado antes»: deja de estar pendiente sin mover plata.</p>}
      <Field label="¿Con qué cuenta pagas?">
        <AccountSelect accounts={data.accounts} value={accountId} onChange={setAccountId} filter={(a) => a.type !== 'credit' || !c.cardAccountId} exclude={c.cardAccountId} />
      </Field>
    </Sheet>
  );
}

export function HomeScreen(props: {
  onOpenAccount: (id: string) => void;
  onNewAccount: () => void;
  onEditTx: (id: string) => void;
  onGoBudget: () => void;
  onGoGoals: () => void;
  onOpenReview: () => void;
  onLoadDemo: () => void;
  onOpenSettings: () => void;
}) {
  const { data, today, mutate } = useApp();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [paying, setPaying] = useState<CommitmentOccurrence | null>(null);
  const [payDate, setPayDate] = useState('');
  const av = availability(data, today);
  const t = totals(data);
  const bal = accountBalances(data.accounts, data.transactions);
  const last = sortTxs(data.transactions)[0];
  const accounts = data.accounts.filter((a) => !a.archived);

  const header = (
    <header className="home-head">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>Luka</span>
        {data.settings.demoMode && <span className="badge demo">Demo</span>}
      </div>
      <button className="icon-btn" onClick={props.onOpenSettings} aria-label="Ajustes"><Icon name="gear" /></button>
    </header>
  );

  if (!accounts.length) {
    return (
      <div className="screen">
        {header}
        <div className="welcome">
          <h1>Tu plata, clarita.</h1>
          <p>Registra varios gastos en una frase y mira cuánto te queda libre hasta tu próximo pago.</p>
        </div>
        <Empty
          icon="wallet"
          title="Empieza creando una cuenta"
          text="Efectivo, Bancolombia, Nu, Lulo… con lo que tengas hoy."
          action={
            <div className="col gap">
              <button className="btn primary" onClick={props.onNewAccount}>Crear mi primera cuenta</button>
              <button className="btn ghost" onClick={props.onLoadDemo}>Ver con datos de ejemplo</button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen">
      {header}
      {data.reviewItems.length > 0 && <ReviewBanner onOpen={props.onOpenReview} />}

      {/* 1. ¿Cuánto me queda libre? */}
      <section className={`hero ${av.shortfall > 0 ? 'short' : ''}`}>
        <span className="hero-label">{av.nextPay ? `Disponible hasta tu próximo pago (${formatShort(av.nextPay)})` : 'Disponible'}</span>
        <Money value={av.available} className="hero-amount" />
        {av.nextPay ? (
          av.shortfall > 0 ? (
            <p className="hero-sub"><Icon name="alert" size={16} /> Te faltan <b><Money value={av.shortfall} /></b> para cubrir compromisos y metas.</p>
          ) : (
            <p className="hero-sub">Puedes gastar aprox. <b><Money value={av.perDay} /></b> al día · {av.daysLeft} {av.daysLeft === 1 ? 'día' : 'días'}</p>
          )
        ) : (
          <form
            className="hero-ask"
            onSubmit={(e) => {
              e.preventDefault();
              if (payDate > today) mutate((r) => r.saveSettings({ nextPayDateOverride: payDate }));
            }}
          >
            <span>¿Cuándo te pagan? Así calculo cuánto puedes gastar al día.</span>
            <div className="row gap">
              <input type="date" min={today} value={payDate} onChange={(e) => setPayDate(e.target.value)} aria-label="Próximo pago" />
              <button className="btn light" disabled={!payDate || payDate <= today}>Listo</button>
            </div>
            <button type="button" className="link light" onClick={props.onGoBudget}>Configurar quincenas fijas</button>
          </form>
        )}
        <button className="link light" onClick={() => setShowBreakdown((s) => !s)} aria-expanded={showBreakdown}>
          {showBreakdown ? 'Ocultar desglose' : 'Ver desglose'}
        </button>
        {showBreakdown && (
          <dl className="breakdown">
            <div><dt>Saldo en cuentas{av.excludedAccounts.length ? ` (sin ${av.excludedAccounts.join(', ')})` : ''}</dt><dd><Money value={av.liquid} /></dd></div>
            {!av.goalsExcluded && <div><dt>− Separado para metas</dt><dd><Money value={-av.reservedGoals} /></dd></div>}
            <div><dt>− Compromisos pendientes</dt><dd><Money value={-av.pendingCommitments} /></dd></div>
            <div className="total"><dt>= Disponible</dt><dd><Money value={av.available} /></dd></div>
            {data.goals.length > 0 && (
              <label className="check light-check">
                <input type="checkbox" checked={!av.goalsExcluded} onChange={(e) => mutate((r) => r.saveSettings({ goalsReduceAvailable: e.target.checked }))} />
                Descontar lo separado para metas
              </label>
            )}
            {t.debt > 0 && <div className="note"><dt>Deuda en tarjetas (aparte)</dt><dd><Money value={t.debt} /></dd></div>}
          </dl>
        )}
      </section>

      {/* 2. Compromisos próximos */}
      <section className="card">
        <div className="row between">
          <h3 className="card-title">Próximos pagos</h3>
          <button className="link" onClick={props.onGoBudget}>Ver todos</button>
        </div>
        {!av.nextPay ? (
          <p className="muted small">Configura tu fecha de pago para ver qué vence antes.</p>
        ) : av.pending.length === 0 ? (
          <p className="muted small">Nada pendiente antes del {formatShort(av.nextPay)}. {data.commitments.length === 0 && <button className="link" onClick={props.onGoBudget}>Agregar arriendo, plan, tarjeta…</button>}</p>
        ) : (
          <ul className="commit-list">
            {av.pending.map((o) => (
              <li key={`${o.commitment.id}:${o.dueDate}`}>
                <span className={`due ${o.overdue ? 'late' : ''}`}>{o.overdue ? 'Vencido' : formatHuman(o.dueDate, today)}</span>
                <span className="grow">{o.commitment.name}</span>
                <Money value={o.commitment.amount} />
                <button className="btn tiny" onClick={() => setPaying(o)}>Pagar</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 3. Último movimiento */}
      <section className="card">
        <h3 className="card-title">Último movimiento</h3>
        {last ? <ul className="tx-list"><TxRow t={last} onClick={() => props.onEditTx(last.id)} /></ul> : <p className="muted small">Aún no registras nada. Toca <b>Registrar</b> abajo.</p>}
      </section>

      {/* 4. ¿Cuánto tengo? */}
      <section className="card">
        <div className="row between">
          <h3 className="card-title">Cuentas</h3>
          <button className="link" onClick={props.onNewAccount}>+ Agregar</button>
        </div>
        <ul className="acc-list">
          {accounts.map((a) => (
            <li key={a.id}>
              <button className="acc" onClick={() => props.onOpenAccount(a.id)}>
                <span className="acc-dot" style={{ background: a.color }} />
                <span className="grow">{a.name}{a.type === 'credit' && <span className="muted small"> · deuda</span>}{a.excludeFromAvailable && <span className="muted small"> · aparte</span>}</span>
                {a.hideBalance ? <span className="money muted">$ •••••</span> : <Money value={bal.get(a.id) ?? 0} className={a.type === 'credit' && (bal.get(a.id) ?? 0) > 0 ? 'debt' : ''} />}
                <Icon name="chev" size={16} />
              </button>
              <button
                className="icon-btn small eye"
                aria-label={a.hideBalance ? `Mostrar saldo de ${a.name}` : `Ocultar saldo de ${a.name}`}
                aria-pressed={!!a.hideBalance}
                onClick={() => mutate((r) => r.put('accounts', { ...a, hideBalance: !a.hideBalance }))}
              >
                <Icon name={a.hideBalance ? 'eyeOff' : 'eye'} size={18} />
              </button>
            </li>
          ))}
        </ul>
        <div className="acc-total">
          <span>Tienes</span><Money value={t.liquid} className="strong" />
          {t.debt > 0 && <><span>Debes</span><Money value={t.debt} className="strong debt" /></>}
        </div>
      </section>

      {/* 5. ¿Cómo van mis metas? */}
      <section className="card">
        <div className="row between">
          <h3 className="card-title">Metas</h3>
          <button className="link" onClick={props.onGoGoals}>{data.goals.length ? 'Ver metas' : 'Crear meta'}</button>
        </div>
        {data.goals.length === 0 ? (
          <p className="muted small">Ahorra para un viaje o un celular y te digo cuánto separar por quincena.</p>
        ) : (
          data.goals.map((g) => {
            const p = goalPlan(g, data, today);
            return (
              <div key={g.id} className="goal-mini">
                <div className="row between"><span>{g.emoji} {g.name}</span><span className="muted small">{Math.round(p.progress * 100)}%</span></div>
                <Progress value={p.progress} />
              </div>
            );
          })
        )}
      </section>

      {paying && <PayCommitmentSheet occ={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}

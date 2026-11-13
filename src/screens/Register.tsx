// Registrar: texto, dictado o formulario → borradores editables → guardar.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ruleKey } from '../domain/categories';
import { formatHuman } from '../domain/dates';
import { formatCOP } from '../domain/money';
import { draftReady, parseSentence, type Draft } from '../domain/parser';
import { uid } from '../domain/text';
import type { TxKind, TxSource } from '../domain/types';
import { useApp } from '../state';
import { AccountSelect, AmountInput, CategorySelect, Field, Icon, Segmented, Sheet } from '../ui/kit';

export type RegisterMode = 'texto' | 'voz' | 'form';

// ---------- Dictado con Web Speech API ----------
type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getSpeech(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => typeof window !== 'undefined' && !!getSpeech();

function useDictation(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<InstanceType<SpeechCtor> | null>(null);
  const finalText = useRef('');

  const start = () => {
    const S = getSpeech();
    if (!S) return;
    setError(null);
    finalText.current = '';
    const r = new S();
    r.lang = 'es-CO';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let txt = '';
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      finalText.current = txt;
      setInterim(txt);
    };
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'Sin permiso para usar el micrófono.' : e.error === 'no-speech' ? 'No te escuché. Intenta de nuevo.' : `Error de dictado: ${e.error}`);
    };
    r.onend = () => {
      setListening(false);
      if (finalText.current.trim()) onFinal(finalText.current.trim());
    };
    rec.current = r;
    r.start();
    setListening(true);
  };
  const stop = () => rec.current?.stop();
  useEffect(() => () => rec.current?.stop(), []);
  return { listening, interim, error, start, stop };
}

// ---------- Tarjeta de borrador ----------
function DraftCard({ d, onChange, onRemove, suggestedCat }: { d: Draft; onChange: (d: Draft) => void; onRemove: () => void; suggestedCat?: string }) {
  const { data, today } = useApp();
  const ambiguous = d.issues.find((i) => i.type === 'amount_ambiguous');
  const accAmb = d.issues.find((i) => i.type === 'account_ambiguous');
  const set = (p: Partial<Draft>) => onChange({ ...d, ...p });
  const changedCat = d.kind !== 'transfer' && suggestedCat !== undefined && d.categoryId !== suggestedCat;
  const ready = draftReady(d);

  const setKind = (k: TxKind) => {
    const cat = k === 'transfer' ? undefined : data.categories.find((c) => c.kind === k && c.id === d.categoryId)?.id ?? (k === 'income' ? 'otros_ingresos' : 'otros');
    set({ kind: k, categoryId: cat, toAccountId: k === 'transfer' ? d.toAccountId ?? null : undefined });
  };

  return (
    <div className={`draft ${ready ? 'ok' : 'needs'}`}>
      <div className="draft-top">
        <Segmented
          label="Tipo"
          value={d.kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Gasto' },
            { value: 'income', label: 'Ingreso' },
            { value: 'transfer', label: 'Transferencia' }
          ]}
        />
        <button className="icon-btn small" onClick={onRemove} aria-label="Quitar borrador">
          <Icon name="close" size={18} />
        </button>
      </div>
      {d.sourceText && <p className="draft-src">«{d.sourceText}»</p>}

      <Field label="Monto">
        <AmountInput value={d.amount} onChange={(v) => set({ amount: v, issues: d.issues.filter((i) => i.type !== 'amount_ambiguous' && i.type !== 'amount_missing') })} invalid={!d.amount} />
      </Field>
      {ambiguous && ambiguous.type === 'amount_ambiguous' && !d.amount && (
        <div className="ask">
          <Icon name="alert" size={16} /> ¿Cuánto fue?
          {ambiguous.options.map((o) => (
            <button key={o} className="chip" onClick={() => set({ amount: o, issues: d.issues.filter((i) => i !== ambiguous) })}>
              {formatCOP(o)}
            </button>
          ))}
        </div>
      )}

      <div className="grid2">
        <Field label="Fecha">
          <input type="date" value={d.date} max={today} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </Field>
        {d.kind !== 'transfer' ? (
          <Field label="Categoría" hint={changedCat ? `Lo recordaré para «${ruleKey(d.description) || d.description}»` : d.learnedCategory ? 'Según lo que corregiste antes' : undefined}>
            <CategorySelect categories={data.categories} value={d.categoryId} onChange={(id) => set({ categoryId: id })} kind={d.kind} />
          </Field>
        ) : (
          <Field label="Descripción">
            <input value={d.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        )}
      </div>

      {d.kind !== 'transfer' && (
        <Field label="Descripción">
          <input value={d.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      )}

      <div className={d.kind === 'transfer' ? 'grid2' : ''}>
        <Field label={d.kind === 'transfer' ? 'Desde' : d.kind === 'income' ? 'Entra a' : 'Pagaste con'}>
          <AccountSelect
            accounts={data.accounts}
            value={d.accountId}
            invalid={!d.accountId}
            filter={d.kind === 'income' ? (a) => a.type !== 'credit' : undefined}
            onChange={(id) => set({ accountId: id, issues: d.issues.filter((i) => i.type !== 'account_missing' && i.type !== 'account_ambiguous') })}
          />
        </Field>
        {d.kind === 'transfer' && (
          <Field label="Hacia" hint={data.accounts.find((a) => a.id === d.toAccountId)?.type === 'credit' ? 'Pago de tarjeta: baja la deuda, no es gasto' : undefined}>
            <AccountSelect accounts={data.accounts} value={d.toAccountId} invalid={!d.toAccountId} exclude={d.accountId} onChange={(id) => set({ toAccountId: id })} />
          </Field>
        )}
      </div>
      {accAmb && accAmb.type === 'account_ambiguous' && !d.accountId && (
        <div className="ask">
          <Icon name="alert" size={16} /> Mencionaste varias cuentas, ¿cuál usaste?
          {accAmb.options.map((id) => (
            <button key={id} className="chip" onClick={() => set({ accountId: id })}>
              {data.accounts.find((a) => a.id === id)?.name}
            </button>
          ))}
        </div>
      )}
      {!d.accountId && !accAmb && data.accounts.length > 1 && <p className="warn-line">No dijiste con qué cuenta. Elígela arriba.</p>}
    </div>
  );
}

// ---------- Hoja Registrar ----------
export function RegisterSheet({ initialMode, onClose, onNeedAccount }: { initialMode: RegisterMode; onClose: () => void; onNeedAccount: () => void }) {
  const { data, today, mutate, toast, repo } = useApp();
  const [mode, setMode] = useState<RegisterMode>(initialMode);
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [suggested, setSuggested] = useState<Record<string, string | undefined>>({});
  const [source, setSource] = useState<TxSource>('texto');
  const [saving, setSaving] = useState(false);
  const canSpeak = speechSupported();

  const interpret = (t: string, src: TxSource) => {
    const ds = parseSentence(t, { accounts: data.accounts, categories: data.categories, rules: data.rules, today });
    setDrafts(ds);
    setSuggested(Object.fromEntries(ds.map((d) => [d.id, d.categoryId])));
    setSource(src);
  };

  const dict = useDictation((t) => {
    setText(t);
    interpret(t, 'voz');
  });

  const blankDraft = (): Draft => ({
    id: uid(),
    kind: 'expense',
    amount: null,
    date: today,
    description: '',
    accountId: data.accounts.filter((a) => !a.archived).length === 1 ? data.accounts.find((a) => !a.archived)!.id : null,
    categoryId: 'otros',
    sourceText: '',
    issues: []
  });

  useEffect(() => {
    if (mode === 'form' && drafts.length === 0) {
      const d = blankDraft();
      setDrafts([d]);
      setSuggested({});
      setSource('manual');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const readyCount = useMemo(() => drafts.filter(draftReady).length, [drafts]);
  const allReady = drafts.length > 0 && readyCount === drafts.length;

  if (!data.accounts.some((a) => !a.archived)) {
    return (
      <Sheet title="Registrar" onClose={onClose}>
        <div className="empty">
          <h3>Primero crea una cuenta</h3>
          <p>Luka necesita saber de dónde sale la plata: efectivo, Bancolombia, Nu…</p>
          <button className="btn primary" onClick={onNeedAccount}>
            Crear cuenta
          </button>
        </div>
      </Sheet>
    );
  }

  const save = async () => {
    if (saving || !allReady) return;
    setSaving(true);
    const ids = drafts.map((d) => d.id);
    await mutate((r) => r.saveDrafts(drafts, source, suggested));
    setSaving(false);
    toast(`${ids.length === 1 ? 'Movimiento guardado' : `${ids.length} movimientos guardados`}`, {
      label: 'Deshacer',
      run: async () => {
        await mutate(async () => {
          for (const id of ids) await repo.deleteTransaction(id);
        });
      }
    });
    onClose();
  };

  return (
    <Sheet
      title="Registrar"
      onClose={onClose}
      footer={
        drafts.length > 0 && (
          <button className="btn primary block" disabled={!allReady || saving} onClick={save}>
            {allReady ? `Guardar ${drafts.length === 1 ? 'movimiento' : `${drafts.length} movimientos`}` : `Completa ${drafts.length - readyCount} ${drafts.length - readyCount === 1 ? 'dato' : 'borradores'} para guardar`}
          </button>
        )
      }
    >
      <Segmented
        label="Forma de registrar"
        value={mode}
        onChange={(m) => {
          setMode(m);
          if (m !== 'form' && source === 'manual') setDrafts([]);
        }}
        options={[
          { value: 'texto', label: 'Texto' },
          { value: 'voz', label: 'Dictado' },
          { value: 'form', label: 'Formulario' }
        ]}
      />

      {mode === 'texto' && (
        <form
          className="compose"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) interpret(text, 'texto');
          }}
        >
          <textarea
            autoFocus
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Hoy gasté 18 lucas en almuerzo con Bancolombia y 12 mil en transporte en efectivo"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (text.trim()) interpret(text, 'texto');
              }
            }}
          />
          <button className="btn primary" type="submit" disabled={!text.trim()}>
            <Icon name="sparkle" size={18} /> Interpretar
          </button>
        </form>
      )}

      {mode === 'voz' && (
        <div className="voice">
          {canSpeak ? (
            <>
              <button className={`mic ${dict.listening ? 'on' : ''}`} onClick={dict.listening ? dict.stop : dict.start} aria-label={dict.listening ? 'Detener dictado' : 'Empezar dictado'}>
                <Icon name="mic" size={34} />
              </button>
              <p className="muted center">{dict.listening ? 'Te escucho… di tus gastos y suelta.' : 'Toca y di algo como «12 mil en transporte en efectivo y 18 lucas de almuerzo con Nu».'}</p>
              {(dict.interim || text) && <p className="transcript">«{dict.interim || text}»</p>}
              {dict.error && <p className="warn-line">{dict.error}</p>}
            </>
          ) : (
            <p className="muted">
              Este navegador no permite dictado dentro de la página. Puedes usar el micrófono de tu teclado en la pestaña <b>Texto</b>; el resultado es el mismo.
            </p>
          )}
        </div>
      )}

      {drafts.length > 0 && (
        <div className="drafts">
          {mode !== 'form' && (
            <p className="drafts-title">
              {drafts.length === 1 ? 'Entendí 1 movimiento' : `Entendí ${drafts.length} movimientos`}. Revísalos antes de guardar:
            </p>
          )}
          {drafts.map((d, i) => (
            <DraftCard
              key={d.id}
              d={d}
              suggestedCat={suggested[d.id]}
              onChange={(nd) => setDrafts((all) => all.map((x, j) => (j === i ? nd : x)))}
              onRemove={() => setDrafts((all) => all.filter((_, j) => j !== i))}
            />
          ))}
          {mode === 'form' && (
            <button className="btn ghost block" onClick={() => setDrafts((all) => [...all, blankDraft()])}>
              <Icon name="plus" size={18} /> Otro movimiento
            </button>
          )}
          {drafts.some((d) => d.date !== today) && <p className="muted small">Fechas: {[...new Set(drafts.map((d) => formatHuman(d.date, today)))].join(', ')}</p>}
        </div>
      )}
      {mode === 'texto' && drafts.length === 0 && text && <p className="muted small">Pulsa Interpretar para ver los borradores.</p>}
    </Sheet>
  );
}
